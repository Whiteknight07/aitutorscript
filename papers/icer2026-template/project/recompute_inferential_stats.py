#!/usr/bin/env python3
"""Recompute the inferential statistics reported in paper.tex.

This script reads the merged tutoring run and the closed-book MCQ file, then
writes JSON and Markdown summaries for:

1. Question-paired single-vs-dual leakage comparisons (exact McNemar tests).
2. Source differences in closed-book accuracy (two-sided Fisher exact tests).
3. Single-tutor correctness-conditioned leakage contrasts (two-sided Fisher
   exact tests; descriptive in the manuscript because none are significant).

It also adds the primary effect size and a 95% confidence interval for each
family:

1. Matched odds ratios for the paired single-vs-dual leakage comparisons.
2. Absolute accuracy gaps (CSBench - PeerWise) for source-level accuracy.
3. Absolute leakage gaps (closed-book correct - closed-book wrong) for the
   correctness-conditioned contrasts.

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
EFFECT_SIZE_GUIDE = {
  'single_vs_dual_leakage': {
    'effect_size_key': 'matched_odds_ratio_single_vs_dual',
    'effect_size_label': 'Matched odds ratio (single / dual leakage odds among discordant question pairs)',
    'ci_level': 0.95,
    'ci_method': 'Exact Clopper-Pearson interval on the discordant-pair binomial proportion, transformed to an odds ratio',
    'why_this_choice': (
      'The question-paired design and exact McNemar test are identified by the '
      'discordant pairs only, so the matched odds ratio is the natural primary '
      'effect size for the main supervision comparison.'
    ),
    'secondary_context': 'Absolute leakage-rate drops are retained as descriptive percentages.',
  },
  'source_accuracy': {
    'effect_size_key': 'csbench_minus_pairwise_accuracy_gap',
    'effect_size_label': 'Absolute accuracy gap (CSBench - PeerWise)',
    'ci_level': 0.95,
    'ci_method': 'Newcombe-Wilson score interval for the difference between independent proportions',
    'why_this_choice': (
      'The claim is explicitly about how many percentage points accuracy drops '
      'from CSBench to PeerWise, so an absolute gap is more interpretable than '
      'a ratio-based effect size here.'
    ),
  },
  'single_tutor_correctness_conditioned_leakage': {
    'effect_size_key': 'correct_minus_wrong_leakage_gap',
    'effect_size_label': 'Absolute leakage gap (closed-book correct - closed-book wrong)',
    'ci_level': 0.95,
    'ci_method': 'Newcombe-Wilson score interval for the difference between independent proportions',
    'why_this_choice': (
      'These within-cell contrasts are descriptive and some wrong-answer cells '
      'are modest, so a percentage-point leakage gap is the clearest measure '
      'of substantive contrast without overstating small-cell ratios.'
    ),
  },
}
Z_975 = 1.959963984540054


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


def logsumexp(values: list[float]) -> float:
  if not values:
    return float('-inf')
  pivot = max(values)
  if math.isinf(pivot):
    return pivot
  return pivot + math.log(sum(math.exp(value - pivot) for value in values))


def log_binomial_pmf(k: int, n: int, p: float) -> float:
  if p <= 0.0:
    return 0.0 if k == 0 else float('-inf')
  if p >= 1.0:
    return 0.0 if k == n else float('-inf')
  return (
    math.lgamma(n + 1)
    - math.lgamma(k + 1)
    - math.lgamma(n - k + 1)
    + k * math.log(p)
    + (n - k) * math.log1p(-p)
  )


def binomial_cdf(k: int, n: int, p: float) -> float:
  if k < 0:
    return 0.0
  if k >= n:
    return 1.0
  return math.exp(logsumexp([log_binomial_pmf(i, n, p) for i in range(k + 1)]))


def binomial_sf(k: int, n: int, p: float) -> float:
  if k <= 0:
    return 1.0
  if k > n:
    return 0.0
  return math.exp(logsumexp([log_binomial_pmf(i, n, p) for i in range(k, n + 1)]))


def clopper_pearson_interval(k: int, n: int, confidence: float = 0.95) -> tuple[float, float]:
  if n <= 0:
    return (0.0, 1.0)

  alpha = 1.0 - confidence

  if k == 0:
    lower = 0.0
  else:
    target = alpha / 2.0
    lo = 0.0
    hi = k / n
    for _ in range(80):
      mid = (lo + hi) / 2.0
      if binomial_sf(k, n, mid) > target:
        hi = mid
      else:
        lo = mid
    lower = (lo + hi) / 2.0

  if k == n:
    upper = 1.0
  else:
    target = alpha / 2.0
    lo = k / n
    hi = 1.0
    for _ in range(80):
      mid = (lo + hi) / 2.0
      if binomial_cdf(k, n, mid) > target:
        lo = mid
      else:
        hi = mid
    upper = (lo + hi) / 2.0

  return (lower, upper)


def wilson_interval(successes: int, total: int, confidence: float = 0.95) -> tuple[float, float]:
  if total <= 0:
    return (0.0, 1.0)

  p_hat = successes / total
  z = Z_975 if math.isclose(confidence, 0.95) else Z_975
  z_sq = z * z
  denom = 1.0 + z_sq / total
  center = (p_hat + z_sq / (2.0 * total)) / denom
  radius = (
    z
    * math.sqrt((p_hat * (1.0 - p_hat) + z_sq / (4.0 * total)) / total)
    / denom
  )
  return (max(0.0, center - radius), min(1.0, center + radius))


def newcombe_difference_interval(
  successes_a: int,
  total_a: int,
  successes_b: int,
  total_b: int,
  confidence: float = 0.95,
) -> tuple[float, float]:
  if total_a <= 0 or total_b <= 0:
    return (-1.0, 1.0)

  rate_a = successes_a / total_a
  rate_b = successes_b / total_b
  low_a, high_a = wilson_interval(successes_a, total_a, confidence=confidence)
  low_b, high_b = wilson_interval(successes_b, total_b, confidence=confidence)

  lower = rate_a - rate_b - math.sqrt((rate_a - low_a) ** 2 + (high_b - rate_b) ** 2)
  upper = rate_a - rate_b + math.sqrt((high_a - rate_a) ** 2 + (rate_b - low_b) ** 2)
  return (max(-1.0, lower), min(1.0, upper))


def matched_odds_ratio_with_ci(
  single_only: int,
  dual_only: int,
  confidence: float = 0.95,
) -> dict[str, float | None]:
  discordant = single_only + dual_only
  if discordant == 0:
    return {
      'discordant_pairs': 0,
      'matched_odds_ratio': 1.0,
      'matched_odds_ratio_ci_low': 1.0,
      'matched_odds_ratio_ci_high': 1.0,
    }

  lower_p, upper_p = clopper_pearson_interval(single_only, discordant, confidence=confidence)

  odds_ratio = math.inf if dual_only == 0 else single_only / dual_only
  ci_low = math.inf if math.isclose(lower_p, 1.0) else lower_p / (1.0 - lower_p)
  ci_high = math.inf if math.isclose(upper_p, 1.0) else upper_p / (1.0 - upper_p)

  return {
    'discordant_pairs': discordant,
    'matched_odds_ratio': odds_ratio,
    'matched_odds_ratio_ci_low': ci_low,
    'matched_odds_ratio_ci_high': ci_high,
  }


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
        matched_or = matched_odds_ratio_with_ci(single_only, dual_only)
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
          'discordant_pairs': matched_or['discordant_pairs'],
          'matched_odds_ratio': matched_or['matched_odds_ratio'],
          'matched_odds_ratio_ci_low': matched_or['matched_odds_ratio_ci_low'],
          'matched_odds_ratio_ci_high': matched_or['matched_odds_ratio_ci_high'],
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
    ci_low, ci_high = newcombe_difference_interval(a, csbench['total'], c, pairwise['total'])
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
      'accuracy_gap_ci_low': ci_low,
      'accuracy_gap_ci_high': ci_high,
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
      ci_low, ci_high = newcombe_difference_interval(
        correct_leak,
        correct_total,
        wrong_leak,
        wrong_total,
      )
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
        'correct_minus_wrong_leakage_gap': (correct_leak / correct_total) - (wrong_leak / wrong_total),
        'correct_minus_wrong_leakage_gap_ci_low': ci_low,
        'correct_minus_wrong_leakage_gap_ci_high': ci_high,
        'p_raw': fisher_exact_two_sided(correct_leak, correct_safe, wrong_leak, wrong_safe),
      })

  holm_adjust(results)
  return results


def format_pct(value: float) -> str:
  return f'{100.0 * value:.1f}%'


def format_pct_point_ci(lower: float, upper: float) -> str:
  return f'[{100.0 * lower:.1f}, {100.0 * upper:.1f}]'


def format_signed_pct_points(value: float) -> str:
  return f'{100.0 * value:+.1f} pp'


def format_odds_ratio(value: float) -> str:
  if math.isinf(value):
    return 'inf'
  return f'{value:.2f}'


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
  lines.append('## Effect-Size Conventions')
  lines.append('')
  for family in (
    'single_vs_dual_leakage',
    'source_accuracy',
    'single_tutor_correctness_conditioned_leakage',
  ):
    guide = payload['effect_size_guide'][family]
    lines.append(f"### `{family}`")
    lines.append('')
    lines.append(f"- Primary effect size: {guide['effect_size_label']}")
    lines.append(f"- 95% CI method: {guide['ci_method']}")
    lines.append(f"- Rationale: {guide['why_this_choice']}")
    if guide.get('secondary_context'):
      lines.append(f"- Secondary context: {guide['secondary_context']}")
    lines.append('')

  lines.append('## Single vs Dual Leakage')
  lines.append('')
  lines.append('| Tutor | Source | Comparison | Single | Dual | Discordant (single only / dual only) | Matched OR (95% CI) | Rate drop | p_raw | p_Holm |')
  lines.append('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for row in payload['single_vs_dual_leakage']:
    lines.append(
      f"| {row['tutor_label']} | {row['source_label']} | {row['single_label']} vs {row['dual_label']} | "
      f"{row['single_leak_count']}/{row['n_pairs']} ({format_pct(row['single_leak_rate'])}) | "
      f"{row['dual_leak_count']}/{row['n_pairs']} ({format_pct(row['dual_leak_rate'])}) | "
      f"{row['single_only']} / {row['dual_only']} | "
      f"{format_odds_ratio(row['matched_odds_ratio'])} "
      f"[{format_odds_ratio(row['matched_odds_ratio_ci_low'])}, {format_odds_ratio(row['matched_odds_ratio_ci_high'])}] | "
      f"{format_signed_pct_points(row['absolute_rate_drop'])} | "
      f"{format_p(row['p_raw'])} | {format_p(row['p_holm'])} |"
    )
  lines.append('')

  lines.append('## Source-Level Closed-Book Accuracy')
  lines.append('')
  lines.append('| Tutor | CSBench | PeerWise | Accuracy gap (95% CI) | p_raw | p_Holm |')
  lines.append('| --- | --- | --- | --- | --- | --- |')
  for row in payload['source_accuracy']:
    lines.append(
      f"| {row['tutor_label']} | "
      f"{row['csbench_correct']}/{row['csbench_total']} ({format_pct(row['csbench_accuracy'])}) | "
      f"{row['pairwise_correct']}/{row['pairwise_total']} ({format_pct(row['pairwise_accuracy'])}) | "
      f"{format_signed_pct_points(row['absolute_accuracy_gap'])} "
      f"{format_pct_point_ci(row['accuracy_gap_ci_low'], row['accuracy_gap_ci_high'])} | "
      f"{format_p(row['p_raw'])} | {format_p(row['p_holm'])} |"
    )
  lines.append('')

  lines.append('## Single-Tutor Correctness-Conditioned Leakage')
  lines.append('')
  lines.append('| Tutor | Source | Closed-book correct | Closed-book wrong | Correct - wrong gap (95% CI) | p_raw | p_Holm |')
  lines.append('| --- | --- | --- | --- | --- | --- | --- |')
  for row in payload['single_tutor_correctness_conditioned_leakage']:
    lines.append(
      f"| {row['tutor_label']} | {row['source_label']} | "
      f"{row['correct_leak']}/{row['correct_total']} ({format_pct(row['correct_leak_rate'])}) | "
      f"{row['wrong_leak']}/{row['wrong_total']} ({format_pct(row['wrong_leak_rate'])}) | "
      f"{format_signed_pct_points(row['correct_minus_wrong_leakage_gap'])} "
      f"{format_pct_point_ci(row['correct_minus_wrong_leakage_gap_ci_low'], row['correct_minus_wrong_leakage_gap_ci_high'])} | "
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
    'effect_size_guide': EFFECT_SIZE_GUIDE,
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
