#!/usr/bin/env python3

from __future__ import annotations

import argparse
import html
import json
import shutil
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[4]
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RAW_PATH = (
  REPO_ROOT
  / 'results'
  / 'run_2026-02-24T23-50-44-586Z_merged_2026-02-26T22-58-06-051Z'
  / 'raw.jsonl'
)
DEFAULT_SVG_PATH = PROJECT_ROOT / 'figures' / 'leakage-survival-panels.svg'

SOURCE_LABELS = {
  'csbench': 'CSBench',
  'peerwise': 'PeerWise',
  'pairwise': 'PeerWise',
}
TUTOR_ORDER = ['gpt', 'gemini']
SOURCE_ORDER = ['CSBench', 'PeerWise']
CONDITION_ORDER = ['single', 'gpt-supervisor', 'gemini-supervisor']
CONDITION_STYLES = {
  'single': {
    'label': 'Single',
    'color': '#8c2d04',
    'dash': None,
    'marker': 'circle',
  },
  'gpt-supervisor': {
    'label': 'Dual: GPT supervisor',
    'color': '#16697a',
    'dash': '10 6',
    'marker': 'square',
  },
  'gemini-supervisor': {
    'label': 'Dual: Gemini supervisor',
    'color': '#c77600',
    'dash': '3 5',
    'marker': 'diamond',
  },
}
TUTOR_TITLES = {
  'gpt': 'GPT',
  'gemini': 'Gemini',
}

MAX_TURN = 6
Y_MIN = 75.0
Y_MAX = 100.0


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(
    description='Build the manuscript leakage-survival figure from the merged raw tutoring log.',
  )
  parser.add_argument(
    '--raw',
    type=Path,
    default=DEFAULT_RAW_PATH,
    help=f'Path to merged raw.jsonl (default: {DEFAULT_RAW_PATH})',
  )
  parser.add_argument(
    '--out',
    type=Path,
    default=DEFAULT_SVG_PATH,
    help=f'Output SVG path (default: {DEFAULT_SVG_PATH})',
  )
  return parser.parse_args()


def normalize_source(raw_source: str) -> str:
  key = raw_source.strip().lower()
  if key not in SOURCE_LABELS:
    raise ValueError(f'Unsupported source label: {raw_source!r}')
  return SOURCE_LABELS[key]


def derive_condition(row: dict) -> str:
  supervisor_id = row['config'].get('supervisorId')
  if row['condition'] == 'single' or supervisor_id is None:
    return 'single'
  if supervisor_id == 'gpt':
    return 'gpt-supervisor'
  if supervisor_id == 'gemini':
    return 'gemini-supervisor'
  raise ValueError(f'Unsupported supervisor id: {supervisor_id!r}')


def first_leak_turn(row: dict) -> int | None:
  turn_judgments = row.get('hiddenTrace', {}).get('turnJudgments', [])
  for turn_judgment in sorted(turn_judgments, key=lambda value: int(value['turnIndex'])):
    if turn_judgment.get('judge', {}).get('leakage'):
      return int(turn_judgment['turnIndex'])

  if row.get('judge', {}).get('leakage'):
    raise ValueError(
      f'Conversation {row.get("runId")} / {row.get("pairingId")} leaked but no leaking turn was found.',
    )
  return None


def load_groups(raw_path: Path) -> dict[tuple[str, str, str], list[int | None]]:
  groups: dict[tuple[str, str, str], list[int | None]] = {}
  with raw_path.open('r', encoding='utf-8') as handle:
    for line in handle:
      row = json.loads(line)
      tutor = row['config']['tutorId']
      source = normalize_source(row['question'].get('source') or row['question'].get('dataset'))
      condition = derive_condition(row)
      key = (tutor, source, condition)
      groups.setdefault(key, []).append(first_leak_turn(row))

  expected = {
    (tutor, source, condition)
    for tutor in TUTOR_ORDER
    for source in SOURCE_ORDER
    for condition in CONDITION_ORDER
  }
  missing = sorted(expected.difference(groups))
  if missing:
    raise ValueError(f'Missing required tutor/source/condition groups: {missing}')
  return groups


def compute_survival(groups: dict[tuple[str, str, str], list[int | None]]) -> dict[tuple[str, str, str], dict]:
  survival: dict[tuple[str, str, str], dict] = {}
  for key, first_leaks in groups.items():
    n = len(first_leaks)
    values = []
    for turn in range(1, MAX_TURN + 1):
      survivors = sum(1 for leak_turn in first_leaks if leak_turn is None or leak_turn > turn)
      values.append(100.0 * survivors / n)
    survival[key] = {
      'n': n,
      'values': values,
    }
  return survival


def svg_text(
  x: float,
  y: float,
  value: str,
  *,
  size: int = 15,
  weight: str = '400',
  anchor: str = 'start',
  fill: str = '#111111',
  extra: str = '',
) -> str:
  attrs = f'font-size="{size}" font-weight="{weight}" text-anchor="{anchor}" fill="{fill}"'
  if extra:
    attrs = f'{attrs} {extra}'
  return f'<text x="{x:.1f}" y="{y:.1f}" {attrs}>{html.escape(value)}</text>'


def marker_svg(x: float, y: float, marker: str, color: str) -> str:
  if marker == 'circle':
    return (
      f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4.8" fill="white" '
      f'stroke="{color}" stroke-width="2.2" />'
    )
  if marker == 'square':
    return (
      f'<rect x="{x - 4.5:.1f}" y="{y - 4.5:.1f}" width="9.0" height="9.0" fill="white" '
      f'stroke="{color}" stroke-width="2.0" />'
    )
  if marker == 'diamond':
    points = [
      f'{x:.1f},{y - 5.3:.1f}',
      f'{x + 5.3:.1f},{y:.1f}',
      f'{x:.1f},{y + 5.3:.1f}',
      f'{x - 5.3:.1f},{y:.1f}',
    ]
    return (
      f'<polygon points="{" ".join(points)}" fill="white" '
      f'stroke="{color}" stroke-width="2.0" />'
    )
  raise ValueError(f'Unsupported marker type: {marker}')


def adjust_label_positions(base_positions: list[float], min_y: float, max_y: float) -> list[float]:
  if not base_positions:
    return []

  ordered = list(enumerate(base_positions))
  ordered.sort(key=lambda item: item[1])
  min_gap = 14.0
  adjusted: list[list[float]] = [[index, y] for index, y in ordered]
  for idx in range(1, len(adjusted)):
    adjusted[idx][1] = max(adjusted[idx][1], adjusted[idx - 1][1] + min_gap)

  overflow = adjusted[-1][1] - max_y
  if overflow > 0:
    for item in adjusted:
      item[1] -= overflow

  underflow = min_y - adjusted[0][1]
  if underflow > 0:
    for item in adjusted:
      item[1] += underflow

  output = [0.0] * len(base_positions)
  for index, y in adjusted:
    output[index] = y
  return output


def build_svg(summary: dict[tuple[str, str, str], dict]) -> str:
  width = 1100
  height = 770
  left_margin = 72
  right_margin = 28
  top_margin = 106
  bottom_margin = 62
  col_gap = 44
  row_gap = 48
  panel_width = (width - left_margin - right_margin - col_gap) / 2.0
  panel_height = (height - top_margin - bottom_margin - row_gap) / 2.0

  inner_left = 54
  inner_right = 76
  inner_top = 50
  inner_bottom = 38

  parts = [
    f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
    f'viewBox="0 0 {width} {height}">',
    '<style><![CDATA[',
    'text { font-family: "Nimbus Roman", "Liberation Serif", serif; }',
    '.tick { fill: #4a4a4a; font-size: 12px; }',
    '.panel-title { fill: #111111; font-size: 17px; font-weight: 700; }',
    '.panel-note { fill: #666666; font-size: 12px; }',
    '.legend-text { fill: #202020; font-size: 14px; }',
    ']]></style>',
    f'<rect x="0" y="0" width="{width}" height="{height}" fill="white" />',
  ]

  legend_y = 48
  legend_items = [
    (180, 'single'),
    (458, 'gpt-supervisor'),
    (786, 'gemini-supervisor'),
  ]
  for x, condition in legend_items:
    style = CONDITION_STYLES[condition]
    dash_attr = ''
    if style['dash'] is not None:
      dash_attr = f' stroke-dasharray="{style["dash"]}"'
    parts.append(
      f'<line x1="{x - 48}" y1="{legend_y:.1f}" x2="{x + 2}" y2="{legend_y:.1f}" '
      f'stroke="{style["color"]}" stroke-width="3.0" stroke-linecap="round"{dash_attr} />'
    )
    parts.append(marker_svg(x - 23, legend_y, style['marker'], style['color']))
    parts.append(svg_text(x + 14, legend_y + 5, style['label'], size=14, weight='600', extra='class="legend-text"'))

  parts.append(svg_text(26, height / 2.0, 'Leakage-free conversations (%)', size=16, weight='700', extra='transform="rotate(-90 26 385)"'))
  parts.append(svg_text(width / 2.0, height - 12, 'Student-visible turn', size=16, weight='700', anchor='middle'))
  parts.append(svg_text(width - 24, height - 12, 'Y-axis truncated to 75-100% to show late-turn divergence.', size=12, anchor='end', fill='#666666'))

  for row_index, tutor in enumerate(TUTOR_ORDER):
    for column_index, source in enumerate(SOURCE_ORDER):
      panel_x = left_margin + column_index * (panel_width + col_gap)
      panel_y = top_margin + row_index * (panel_height + row_gap)
      plot_x = panel_x + inner_left
      plot_y = panel_y + inner_top
      plot_width = panel_width - inner_left - inner_right
      plot_height = panel_height - inner_top - inner_bottom

      key_single = (tutor, source, 'single')
      panel_n = summary[key_single]['n']
      title = f'{TUTOR_TITLES[tutor]} tutor / {source}'

      parts.append(
        f'<rect x="{panel_x:.1f}" y="{panel_y:.1f}" width="{panel_width:.1f}" height="{panel_height:.1f}" '
        f'rx="14" ry="14" fill="#fbfbfb" stroke="#d9d9d9" stroke-width="1.2" />'
      )
      parts.append(
        f'<rect x="{plot_x:.1f}" y="{plot_y:.1f}" width="{plot_width:.1f}" height="{plot_height:.1f}" '
        f'fill="white" stroke="#e0e0e0" stroke-width="1.0" />'
      )
      parts.append(svg_text(panel_x + 18, panel_y + 28, title, size=17, weight='700', extra='class="panel-title"'))
      parts.append(
        svg_text(
          panel_x + panel_width - 18,
          panel_y + 28,
          f'n = {panel_n}',
          size=12,
          anchor='end',
          fill='#666666',
          extra='class="panel-note"',
        ),
      )

      def x_for_turn(turn: int) -> float:
        return plot_x + plot_width * (turn - 1) / (MAX_TURN - 1)

      def y_for_value(value: float) -> float:
        return plot_y + plot_height * (Y_MAX - value) / (Y_MAX - Y_MIN)

      for tick_value in range(int(Y_MIN), int(Y_MAX) + 1, 5):
        tick_y = y_for_value(float(tick_value))
        parts.append(
          f'<line x1="{plot_x:.1f}" y1="{tick_y:.1f}" x2="{plot_x + plot_width:.1f}" y2="{tick_y:.1f}" '
          f'stroke="#ececec" stroke-width="1.0" />'
        )
        if column_index == 0:
          parts.append(svg_text(plot_x - 10, tick_y + 4, f'{tick_value}', size=12, anchor='end', fill='#555555'))

      for turn in range(1, MAX_TURN + 1):
        tick_x = x_for_turn(turn)
        parts.append(
          f'<line x1="{tick_x:.1f}" y1="{plot_y:.1f}" x2="{tick_x:.1f}" y2="{plot_y + plot_height:.1f}" '
          f'stroke="#f3f3f3" stroke-width="1.0" />'
        )
        parts.append(
          f'<line x1="{tick_x:.1f}" y1="{plot_y + plot_height:.1f}" x2="{tick_x:.1f}" y2="{plot_y + plot_height + 5:.1f}" '
          f'stroke="#777777" stroke-width="1.1" />'
        )
        parts.append(svg_text(tick_x, plot_y + plot_height + 20, str(turn), size=12, anchor='middle', fill='#555555'))

      label_bases = []
      curve_positions = []
      for condition in CONDITION_ORDER:
        values = summary[(tutor, source, condition)]['values']
        style = CONDITION_STYLES[condition]
        points = [(x_for_turn(turn), y_for_value(value)) for turn, value in enumerate(values, start=1)]
        curve_positions.append((condition, values, points))
        label_bases.append(points[-1][1])

      label_positions = adjust_label_positions(label_bases, plot_y + 10, plot_y + plot_height - 4)

      for index, (condition, values, points) in enumerate(curve_positions):
        style = CONDITION_STYLES[condition]
        points_str = ' '.join(f'{x:.1f},{y:.1f}' for x, y in points)
        dash_attr = ''
        if style['dash'] is not None:
          dash_attr = f' stroke-dasharray="{style["dash"]}"'
        parts.append(
          f'<polyline points="{points_str}" fill="none" stroke="{style["color"]}" stroke-width="3.0" '
          f'stroke-linecap="round" stroke-linejoin="round"{dash_attr} />'
        )
        for x, y in points:
          parts.append(marker_svg(x, y, style['marker'], style['color']))

        label_x = plot_x + plot_width + 12
        label_y = label_positions[index]
        final_x, final_y = points[-1]
        parts.append(
          f'<line x1="{final_x + 3:.1f}" y1="{final_y:.1f}" x2="{label_x - 6:.1f}" y2="{label_y:.1f}" '
          f'stroke="{style["color"]}" stroke-width="1.6" />'
        )
        parts.append(svg_text(label_x, label_y + 4, f'{values[-1]:.1f}%', size=13, weight='700', fill=style['color']))

  parts.append('</svg>')
  return '\n'.join(parts)


def write_outputs(svg_text_value: str, out_svg: Path) -> None:
  out_svg.parent.mkdir(parents=True, exist_ok=True)
  out_svg.write_text(svg_text_value, encoding='utf-8')

  out_pdf = out_svg.with_suffix('.pdf')
  converter = shutil.which('rsvg-convert')
  if converter is None:
    print('warning: rsvg-convert not found; wrote SVG only.', file=sys.stderr)
    return

  subprocess.run(
    [converter, '-f', 'pdf', '-o', str(out_pdf), str(out_svg)],
    check=True,
  )


def main() -> int:
  args = parse_args()
  raw_path = args.raw.resolve()
  out_svg = args.out.resolve()
  groups = load_groups(raw_path)
  summary = compute_survival(groups)
  svg_markup = build_svg(summary)
  write_outputs(svg_markup, out_svg)

  for tutor in TUTOR_ORDER:
    for source in SOURCE_ORDER:
      for condition in CONDITION_ORDER:
        entry = summary[(tutor, source, condition)]
        values = ', '.join(f't{turn}={value:.1f}%' for turn, value in enumerate(entry['values'], start=1))
        print(f'{tutor}/{source}/{condition}: n={entry["n"]}; {values}')
  print(f'wrote {out_svg}')
  print(f'wrote {out_svg.with_suffix(".pdf")}')
  return 0


if __name__ == '__main__':
  raise SystemExit(main())
