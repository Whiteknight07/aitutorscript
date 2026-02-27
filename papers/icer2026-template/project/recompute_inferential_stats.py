#!/usr/bin/env python3
"""Recompute the exact inferential statistics reported in paper.tex.

This script uses only the Python standard library. It reads the merged tutoring
run and the closed-book MCQ file, then writes JSON and Markdown summaries for:

1. Question-paired single-vs-dual leakage comparisons (exact McNemar tests).
2. Source differences in closed-book accuracy (two-sided Fisher exact tests).
3. Single-tutor correctness-conditioned leakage contrasts (two-sided Fisher
   exact tests; descriptive in the manuscript because none are significant).

Default inputs target the paper's fixed artifacts but can be overridden.
"""

from __future__ import annotations

import argparse
import json
import math
from fractions import Fraction
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_RAW = REPO_ROOT / 'results' / 'run_2026-02-24T23-50-44-586Z_merged_2026-02-26T22-58-06-051Z' / 'raw.jsonl'
DEFAULT_ACCURACY = REPO_ROOT / 'results' / 'mcq_accuracy_2026-02-24T04-24-19-103Z.jsonl'
DEFAULT_JSON_OUT = Path(__file__).with_name('inferential_stats.json')
DEFAULT_MD_OUT = Path(__file__).with_name('inferential_stats.md')

SOURCE_LABELS = {
  'csbench': 'CSBench',
  'pairwise': 'PeerWise',
}
MODEL_LABELS = {
  'openai/gpt-5.1': 'GPT',
  'google/gemini-3-flash-preview': 'Gemini',
}
PAIRING_LABELS = {
  'gpt-single': 'Single',
  'gemini-single': 'Single',
  'gpt-gpt': 'Dual/GPT',
  'gpt-gemini': 'Dual/Gemini',
  'gemini-gemini': 'Dual/Gemini',
  'gemini-gpt': 'Dual/GPT',
}
SINGLE_PAIRING_BY_MODEL = {
  'openai/gpt-5.1': 'gpt-single',
  'google/gemini-3-flash-preview': 'gemini-single',
}
DUAL_PAIRINGS_BY_MODEL = {
  'openai/gpt-5.1': ['gpt-gpt', 'gpt-gemini'],
  'google/gemini-3-flash-preview': ['gemini-gemini', 'gemini-gpt'],
}


def normalize_source(value: str | None) -> str:
  normalized = (value or 'unknown').strip().lower()
  if normalized == 'peerwise':
    return 'pairwise'
  return normalized or 'unknown'


def load_accuracy(path: Path) -> dict[str, Any]:
  accuracy_by_key: dict[tuple[str, str], bool] = {}
  accuracy_rows: dict[tuple[str, str], dict[str, int]] = {}

  with path.open('r', encoding='utf-8') as handle:
    for line in handle:
      if not line.strip():
        continue
      row = json.loads(line)
      question_id = row['question_id']
      model_id = row['model_id']
      source = normalize_source(row.get('source'))
      correct = bool(row['correct'])

      accuracy_by_key[(question_id, model_id)] = correct

      key = (model_id, source)
      metrics = accuracy_rows.setdefault(key, {'correct': 0, 'total': 0})
      metrics['total'] += 1
      if correct:
        metrics['correct'] += 1

  return {
    'by_key': accuracy_by_key,
    'by_model_source': accuracy_rows,
  }


def load_outcomes(path: Path) -> dict[str, Any]:
  outcomes: dict[tuple[str, str, str, str], bool] = {}

  with path.open('r', encoding='utf-8') as handle:
    for line in handle:
      if not line.strip():
        continue
      row = json.loads(line)
      question = row['question']
      question_id = question['id']
      source = normalize_source(question.get('source') or question.get('dataset'))
      pairing_id = row['pairingId']
      tutor_model = row['config']['models']['tutorModel']
      leakage = bool(row['judge']['leakage'])
      outcomes[(source, pairing_id, tutor_model, question_id)] = leakage

  return {'outcomes': outcomes}


def exact_mcnemar_pvalue(b: int, c: int) -> float:
  """Two-sided exact McNemar p-value via an exact binomial test."""
  n = b + c
  if n == 0:
    return 1.0
  k = min(b, c)
  observed_weight = math.comb(n, k)
  weight_total = 1 << n
  extreme_weight = 0
  for i in range(n + 1):
    if math.comb(n, i) <= observed_weight:
      extreme_weight += math.comb(n, i)
  return min(1.0, extreme_weight / weight_total)


def fisher_exact_two_sided(a: int, b: int, c: int, d: int) -> float:
  """Two-sided Fisher exact p-value for a 2x2 table."""
  row1 = a + b
  row2 = c + d
  col1 = a + c
  total = row1 + row2

  denom = math.comb(total, col1)
  observed_weight = math.comb(row1, a) * math.comb(row2, col1 - a)

  lower = max(0, col1 - row2)
  upper = min(col1, row1)

  extreme = Fraction(0, 1)
  for x in range(lower, upper + 1):
    weight = math.comb(row1, x) * math.comb(row2, col1 - x)
    if weight <= observed_weight:
      extreme += Fraction(weight, denom)

  return float(extreme)


def holm_adjust(records: list[dict[str, Any]], p_key: str = 'p_raw') -> None:
  ordered = sorted(enumerate(records), key=lambda item: item[1][p_key])
  running_max = 0.0
  total = len(records)
  for rank, (index, record) in enumerate(ordered):
    adjusted = min(1.0, (total - rank) * record[p_key])
    running_max = max(running_max, adjusted)
    records[index]['p_holm'] = running_max


def compute_single_vs_dual(outcomes: dict[tuple[str, str, str, str], bool]) -> list[dict[str, Any]]:
  results: list[dict[str, Any]] = []

  for tutor_model, single_pairing in SINGLE_PAIRING_BY_MODEL.items():
    for source in ('csbench', 'pairwise'):
      question_ids = sorted(
        question_id
        for (row_source, pairing_id, row_model, question_id), _ in outcomes.items()
        if row_source == source and pairing_id == single_pairing and row_model == tutor_model
      )
      for dual_pairing in DUAL_PAIRINGS_BY_MODEL[tutor_model]:
        both_leak = single_only = dual_only = both_safe = 0
        for question_id in question_ids:
          single_leak = outcomes[(source, single_pairing, tutor_model, question_id)]
          dual_leak = outcomes[(source, dual_pairing, tutor_model, question_id)]
          if single_leak and dual_leak:
            both_leak += 1
          elif single_leak and not dual_leak:
            single_only += 1
          elif not single_leak and dual_leak:
            dual_only += 1
          else:
            both_safe += 1

        total = both_leak + single_only + dual_only + both_safe
        results.append({
          'family': 'single_vs_dual_leakage',
          'tutor_model': tutor_model,
          'tutor_label': MODEL_LABELS[tutor_model],
          'source': source,
          'source_label': SOURCE_LABELS[source],
          'single_pairing': single_pairing,
          'single_label': PAIRING_LABELS[single_pairing],
          'dual_pairing': dual_pairing,
          'dual_label': PAIRING_LABELS[dual_pairing],
          'n_pairs': total,
          'both_leak': both_leak,
          'single_only': single_only,
          'dual_only': dual_only,
          'both_safe': both_safe,
          'single_leak_count': both_leak + single_only,
          'dual_leak_count': both_leak + dual_only,
          'single_leak_rate': (both_leak + single_only) / total,
          'dual_leak_rate': (both_leak + dual_only) / total,
          'absolute_rate_drop': ((both_leak + single_only) - (both_leak + dual_only)) / total,
          'p_raw': exact_mcnemar_pvalue(single_only, dual_only),
        })

  holm_adjust(results)
  return results


def compute_source_accuracy(by_model_source: dict[tuple[str, str], dict[str, int]]) -> list[dict[str, Any]]:
  results: list[dict[str, Any]] = []

  for tutor_model in ('openai/gpt-5.1', 'google/gemini-3-flash-preview'):
    csbench = by_model_source[(tutor_model, 'csbench')]
    pairwise = by_model_source[(tutor_model, 'pairwise')]
    a = csbench['correct']
    b = csbench['total'] - csbench['correct']
    c = pairwise['correct']
    d = pairwise['total'] - pairwise['correct']
    results.append({
      'family': 'source_accuracy',
      'tutor_model': tutor_model,
      'tutor_label': MODEL_LABELS[tutor_model],
      'csbench_correct': a,
      'csbench_total': csbench['total'],
      'pairwise_correct': c,
      'pairwise_total': pairwise['total'],
      'csbench_accuracy': a / csbench['total'],
      'pairwise_accuracy': c / pairwise['total'],
      'absolute_accuracy_gap': (a / csbench['total']) - (c / pairwise['total']),
      'p_raw': fisher_exact_two_sided(a, b, c, d),
    })

  holm_adjust(results)
  return results


def compute_correctness_conditioned(
  outcomes: dict[tuple[str, str, str, str], bool],
  accuracy_by_key: dict[tuple[str, str], bool],
) -> list[dict[str, Any]]:
  results: list[dict[str, Any]] = []

  for tutor_model, single_pairing in SINGLE_PAIRING_BY_MODEL.items():
    for source in ('csbench', 'pairwise'):
      correct_leak = correct_safe = wrong_leak = wrong_safe = 0
      for (row_source, pairing_id, row_model, question_id), leak in outcomes.items():
        if row_source != source or pairing_id != single_pairing or row_model != tutor_model:
          continue
        closed_book_correct = accuracy_by_key[(question_id, tutor_model)]
        if closed_book_correct:
          if leak:
            correct_leak += 1
          else:
            correct_safe += 1
        else:
          if leak:
            wrong_leak += 1
          else:
            wrong_safe += 1

      correct_total = correct_leak + correct_safe
      wrong_total = wrong_leak + wrong_safe
      results.append({
        'family': 'single_tutor_correctness_conditioned_leakage',
        'tutor_model': tutor_model,
        'tutor_label': MODEL_LABELS[tutor_model],
        'source': source,
        'source_label': SOURCE_LABELS[source],
        'correct_leak': correct_leak,
        'correct_total': correct_total,
        'wrong_leak': wrong_leak,
        'wrong_total': wrong_total,
        'correct_leak_rate': correct_leak / correct_total,
        'wrong_leak_rate': wrong_leak / wrong_total,
        'p_raw': fisher_exact_two_sided(correct_leak, correct_safe, wrong_leak, wrong_safe),
      })

  holm_adjust(results)
  return results


def format_pct(value: float) -> str:
  return f'{100.0 * value:.1f}%'


def format_p(value: float) -> str:
  if value < 0.001:
    return f'{value:.2e}'
  return f'{value:.4f}'


def render_markdown(payload: dict[str, Any]) -> str:
  lines: list[str] = []
  lines.append('# Inferential Statistics Summary')
  lines.append('')
  lines.append('Inputs:')
  lines.append(f"- Raw tutoring log: `{payload['inputs']['raw_path']}`")
  lines.append(f"- Closed-book file: `{payload['inputs']['accuracy_path']}`")
  lines.append('')

  lines.append('## Single vs Dual Leakage')
  lines.append('')
  lines.append('| Tutor | Source | Comparison | Single | Dual | Discordant (single only / dual only) | p_raw | p_Holm |')
  lines.append('| --- | --- | --- | --- | --- | --- | --- | --- |')
  for row in payload['single_vs_dual_leakage']:
    lines.append(
      f"| {row['tutor_label']} | {row['source_label']} | {row['single_label']} vs {row['dual_label']} | "
      f"{row['single_leak_count']}/{row['n_pairs']} ({format_pct(row['single_leak_rate'])}) | "
      f"{row['dual_leak_count']}/{row['n_pairs']} ({format_pct(row['dual_leak_rate'])}) | "
      f"{row['single_only']} / {row['dual_only']} | {format_p(row['p_raw'])} | {format_p(row['p_holm'])} |"
    )
  lines.append('')

  lines.append('## Source-Level Closed-Book Accuracy')
  lines.append('')
  lines.append('| Tutor | CSBench | PeerWise | Gap | p_raw | p_Holm |')
  lines.append('| --- | --- | --- | --- | --- | --- |')
  for row in payload['source_accuracy']:
    lines.append(
      f"| {row['tutor_label']} | "
      f"{row['csbench_correct']}/{row['csbench_total']} ({format_pct(row['csbench_accuracy'])}) | "
      f"{row['pairwise_correct']}/{row['pairwise_total']} ({format_pct(row['pairwise_accuracy'])}) | "
      f"{format_pct(row['absolute_accuracy_gap'])} | {format_p(row['p_raw'])} | {format_p(row['p_holm'])} |"
    )
  lines.append('')

  lines.append('## Single-Tutor Correctness-Conditioned Leakage')
  lines.append('')
  lines.append('| Tutor | Source | Closed-book correct | Closed-book wrong | p_raw | p_Holm |')
  lines.append('| --- | --- | --- | --- | --- | --- |')
  for row in payload['single_tutor_correctness_conditioned_leakage']:
    lines.append(
      f"| {row['tutor_label']} | {row['source_label']} | "
      f"{row['correct_leak']}/{row['correct_total']} ({format_pct(row['correct_leak_rate'])}) | "
      f"{row['wrong_leak']}/{row['wrong_total']} ({format_pct(row['wrong_leak_rate'])}) | "
      f"{format_p(row['p_raw'])} | {format_p(row['p_holm'])} |"
    )
  lines.append('')

  return '\n'.join(lines)


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument('--raw', type=Path, default=DEFAULT_RAW)
  parser.add_argument('--accuracy', type=Path, default=DEFAULT_ACCURACY)
  parser.add_argument('--json-out', type=Path, default=DEFAULT_JSON_OUT)
  parser.add_argument('--md-out', type=Path, default=DEFAULT_MD_OUT)
  return parser.parse_args()


def main() -> None:
  args = parse_args()

  accuracy = load_accuracy(args.accuracy)
  outcome_payload = load_outcomes(args.raw)

  payload = {
    'inputs': {
      'raw_path': str(args.raw.resolve()),
      'accuracy_path': str(args.accuracy.resolve()),
    },
    'single_vs_dual_leakage': compute_single_vs_dual(outcome_payload['outcomes']),
    'source_accuracy': compute_source_accuracy(accuracy['by_model_source']),
    'single_tutor_correctness_conditioned_leakage': compute_correctness_conditioned(
      outcome_payload['outcomes'],
      accuracy['by_key'],
    ),
  }

  args.json_out.write_text(json.dumps(payload, indent=2), encoding='utf-8')
  args.md_out.write_text(render_markdown(payload) + '\n', encoding='utf-8')

  print(f'Wrote {args.json_out}')
  print(f'Wrote {args.md_out}')


if __name__ == '__main__':
  main()
