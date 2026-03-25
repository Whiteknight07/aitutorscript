#!/usr/bin/env python3
"""Extract risk-gate training rows from harness raw.jsonl outputs."""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass
class ExtractionStats:
  records_total: int = 0
  records_non_dual_loop: int = 0
  records_missing_loop_turns: int = 0
  skipped_missing_draft_iter1: int = 0
  skipped_short_text: int = 0
  malformed_lines: int = 0
  unique_question_groups: int = 0
  holdout_question_groups: int = 0
  rows_written: int = 0


@dataclass
class PendingRow:
  row: dict[str, Any]
  dataset_source: str
  question_group_key: str


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(
    description=(
      'Build one training row per dual-loop tutor turn using first draft (iter=1). '
      'Label is loopTurnIterations.initiallyRejected.'
    )
  )
  parser.add_argument(
    '--inputs',
    nargs='*',
    default=None,
    help='Explicit raw.jsonl file paths. If omitted, --input-glob is used.',
  )
  parser.add_argument(
    '--input-glob',
    default='results/*/raw.jsonl',
    help='Glob used to find raw.jsonl files when --inputs is omitted.',
  )
  parser.add_argument(
    '--output-jsonl',
    default='tmp/risk_gate/turn_dataset.jsonl',
    help='Destination JSONL path for extracted rows.',
  )
  parser.add_argument(
    '--feature-schema-out',
    default='tmp/risk_gate/feature_schema.json',
    help='Path for emitted feature schema/contract JSON.',
  )
  parser.add_argument(
    '--holdout-ratio',
    type=float,
    default=0.2,
    help='Deterministic holdout ratio in range (0,1).',
  )
  parser.add_argument(
    '--split-seed',
    default='risk-gate-v1',
    help='Seed string for deterministic train/holdout assignment.',
  )
  parser.add_argument(
    '--min-feature-text-chars',
    type=int,
    default=20,
    help='Skip rows where assembled feature_text is shorter than this length.',
  )
  parser.add_argument(
    '--fail-on-empty',
    action='store_true',
    help='Exit non-zero when no rows are extracted.',
  )
  return parser.parse_args()


def as_list(value: Any) -> list[Any]:
  return value if isinstance(value, list) else []


def as_dict(value: Any) -> dict[str, Any]:
  return value if isinstance(value, dict) else {}


def as_int(value: Any, default: int = 0) -> int:
  if isinstance(value, bool):
    return int(value)
  if isinstance(value, int):
    return value
  if isinstance(value, float):
    return int(value)
  if isinstance(value, str):
    try:
      return int(value)
    except ValueError:
      return default
  return default


def as_bool(value: Any, default: bool = False) -> bool:
  if isinstance(value, bool):
    return value
  if isinstance(value, (int, float)):
    return bool(value)
  if isinstance(value, str):
    lowered = value.strip().lower()
    if lowered in {'1', 'true', 'yes', 'y'}:
      return True
    if lowered in {'0', 'false', 'no', 'n'}:
      return False
  return default


def stable_hash_hex(value: str) -> str:
  return hashlib.sha256(value.encode('utf-8')).hexdigest()


def normalize_dataset_source(question: dict[str, Any]) -> str:
  dataset = str(question.get('dataset', '')).strip()
  return dataset if dataset else 'unknown'


def normalize_question_id(question: dict[str, Any]) -> str:
  question_id = str(question.get('id', '')).strip()
  if question_id:
    return question_id

  problem_statement = str(question.get('problemStatement', '')).strip()
  if problem_statement:
    digest = stable_hash_hex(problem_statement)
    return f'anon-{digest[:16]}'

  return 'unknown-question'


def build_question_group_key(dataset_source: str, question_id: str) -> str:
  return f'{dataset_source}:{question_id}'


def build_group_split_assignments(
  groups_by_dataset: dict[str, set[str]],
  holdout_ratio: float,
  seed: str,
) -> tuple[dict[str, str], dict[str, int], dict[str, int]]:
  assignment: dict[str, str] = {}
  dataset_group_counts: dict[str, int] = {}
  dataset_holdout_counts: dict[str, int] = {}

  for dataset_source in sorted(groups_by_dataset):
    group_keys = sorted(
      groups_by_dataset[dataset_source],
      key=lambda group_key: stable_hash_hex(f'{seed}:{dataset_source}:{group_key}'),
    )
    group_count = len(group_keys)
    holdout_count = int(round(group_count * holdout_ratio))
    holdout_count = min(max(holdout_count, 0), group_count)

    holdout_keys = set(group_keys[:holdout_count])
    dataset_group_counts[dataset_source] = group_count
    dataset_holdout_counts[dataset_source] = holdout_count

    for group_key in group_keys:
      assignment[group_key] = 'holdout' if group_key in holdout_keys else 'train'

  return assignment, dataset_group_counts, dataset_holdout_counts


def iter_jsonl(path: Path):
  with path.open('r', encoding='utf-8') as fh:
    for line_number, line in enumerate(fh, start=1):
      text = line.strip()
      if not text:
        continue
      yield line_number, text


def build_feature_text(
  question: dict[str, Any],
  student_turn: dict[str, Any],
  student_history: list[dict[str, Any]],
  tutor_draft_iter1: dict[str, Any],
) -> str:
  history_messages = []
  for idx, turn in enumerate(student_history, start=1):
    message = str(turn.get('message', '')).strip()
    if message:
      history_messages.append(f'[{idx}] {message}')

  sections = [
    'QUESTION',
    str(question.get('problemStatement', '')).strip(),
    '',
    'REFERENCE_ANSWER_DESCRIPTION',
    str(question.get('referenceAnswerDescription', '')).strip(),
    '',
    'CURRENT_STUDENT_MESSAGE',
    str(student_turn.get('message', '')).strip(),
    '',
    'CURRENT_STUDENT_TACTIC',
    str(student_turn.get('tactic', '')).strip(),
    '',
    'CURRENT_STUDENT_ATTACK_LEVEL',
    str(student_turn.get('attackLevel', '')),
    '',
    'STUDENT_HISTORY_UP_TO_TURN',
    '\n'.join(history_messages).strip(),
    '',
    'TUTOR_DRAFT_ITER_1',
    str(tutor_draft_iter1.get('text', '')).strip(),
  ]

  return '\n'.join(sections).strip()


def build_feature_schema() -> dict[str, Any]:
  return {
    'schema_version': 'risk-gate-v1',
    'description': (
      'One row per dual-loop turn first draft (iter=1). '
      'Label y_needs_supervision mirrors loopTurnIterations.initiallyRejected.'
    ),
    'id_field': 'example_id',
    'label_field': 'y_needs_supervision',
    'split_field': 'split',
    'split_strategy': {
      'method': 'group_by_question_id',
      'stratify_by': 'dataset_source',
      'seed_field': 'split_seed',
      'holdout_ratio_field': 'holdout_ratio',
    },
    'text_feature_field': 'feature_text',
    'numeric_feature_fields': {
      'turn_index': 'int – 1-based turn index within the conversation',
      'student_attack_level': 'int – attack level from student turn',
      'question_bloom_level': 'int – Bloom taxonomy level of the question',
      'tutor_draft_len': 'int – character length of tutor draft iter1 text',
      'student_message_len': 'int – character length of student turn message',
      'tutor_draft_word_count': 'int – word count of tutor draft iter1 text',
      'student_message_word_count': 'int – word count of student turn message',
      'reference_answer_len': 'int – character length of referenceAnswerDescription',
      'len_ratio_draft_to_reference': 'float – ratio of draft length to reference answer length (0 if empty)',
      'draft_has_equation': 'binary 0/1 – draft contains equation pattern (digits around =)',
      'draft_has_answer_phrase': 'binary 0/1 – draft contains answer-revealing phrases',
      'draft_has_numeric_value': 'binary 0/1 – draft contains multi-digit or decimal numbers',
      'num_prior_student_turns': 'int – number of student turns before current turn',
      'question_difficulty': 'int – difficulty level from question metadata',
    },
    'categorical_string_fields': {
      'student_tactic': 'string – student tactic label (for downstream encoding)',
    },
    'aux_fields': ['aux_turn_leakage'],
    'required_raw_fields': {
      'root': ['condition', 'question', 'loopTurnIterations', 'hiddenTrace'],
      'question': [
        'id',
        'dataset',
        'topicTag',
        'skillTag',
        'courseLevel',
        'bloomLevel',
        'difficulty',
        'problemStatement',
        'referenceAnswerDescription',
      ],
      'hiddenTrace.studentTurns': ['message', 'attackLevel', 'tactic'],
      'hiddenTrace.tutorDrafts': ['turnIndex', 'iter', 'text'],
      'loopTurnIterations': ['turnIndex', 'iterationsUsed', 'initiallyRejected', 'endedApproved', 'rationale'],
      'hiddenTrace.turnJudgments': ['turnIndex', 'judge.leakage'],
    },
    'output_fields': [
      'example_id',
      'split',
      'dataset_source',
      'question_id',
      'question_group_key',
      'y_needs_supervision',
      'aux_turn_leakage',
      'question',
      'student_turn',
      'student_turns_up_to_turn',
      'tutor_draft_iter1',
      'tutor_drafts_for_turn',
      'loop_turn_iteration',
      'feature_text',
      'feature_numeric',
      'student_tactic',
    ],
  }


def main() -> int:
  args = parse_args()

  if not (0.0 < args.holdout_ratio < 1.0):
    raise SystemExit('--holdout-ratio must be in range (0,1).')

  raw_paths = [Path(p) for p in args.inputs] if args.inputs else [Path(p) for p in sorted(glob.glob(args.input_glob))]
  if not raw_paths:
    raise SystemExit(f'No raw.jsonl files found (inputs={args.inputs}, glob={args.input_glob}).')

  output_jsonl = Path(args.output_jsonl)
  feature_schema_out = Path(args.feature_schema_out)
  output_jsonl.parent.mkdir(parents=True, exist_ok=True)
  feature_schema_out.parent.mkdir(parents=True, exist_ok=True)

  stats = ExtractionStats()
  seen_ids: dict[str, int] = {}
  pending_rows: list[PendingRow] = []
  groups_by_dataset: dict[str, set[str]] = {}

  for raw_path in raw_paths:
    for line_number, line in iter_jsonl(raw_path):
      try:
        record = json.loads(line)
      except json.JSONDecodeError:
        stats.malformed_lines += 1
        continue

      stats.records_total += 1
      if str(record.get('condition')) != 'dual-loop':
        stats.records_non_dual_loop += 1
        continue

      question = as_dict(record.get('question'))
      hidden_trace = as_dict(record.get('hiddenTrace'))
      student_turns = [as_dict(x) for x in as_list(hidden_trace.get('studentTurns'))]
      tutor_drafts = [as_dict(x) for x in as_list(hidden_trace.get('tutorDrafts'))]
      turn_judgments = [as_dict(x) for x in as_list(hidden_trace.get('turnJudgments'))]
      loop_turn_iterations = [as_dict(x) for x in as_list(record.get('loopTurnIterations'))]

      if not loop_turn_iterations:
        stats.records_missing_loop_turns += 1
        continue

      draft_by_turn_iter: dict[tuple[int, int], dict[str, Any]] = {}
      drafts_for_turn: dict[int, list[dict[str, Any]]] = {}
      for draft in tutor_drafts:
        turn_index = as_int(draft.get('turnIndex'))
        iter_index = as_int(draft.get('iter'))
        if turn_index <= 0 or iter_index <= 0:
          continue
        draft_by_turn_iter[(turn_index, iter_index)] = draft
        drafts_for_turn.setdefault(turn_index, []).append(draft)

      for turn_index in drafts_for_turn:
        drafts_for_turn[turn_index].sort(key=lambda row: as_int(row.get('iter')))

      judgment_by_turn: dict[int, dict[str, Any]] = {}
      leakage_by_turn: dict[int, bool | None] = {}
      for row in turn_judgments:
        turn_index = as_int(row.get('turnIndex'))
        if turn_index <= 0:
          continue
        judge = as_dict(row.get('judge'))
        leakage_raw = judge.get('leakage')
        leakage_value: bool | None
        if isinstance(leakage_raw, bool):
          leakage_value = leakage_raw
        elif isinstance(leakage_raw, (int, float)):
          leakage_value = bool(leakage_raw)
        else:
          leakage_value = None
        judgment_by_turn[turn_index] = row
        leakage_by_turn[turn_index] = leakage_value

      loop_turn_iterations.sort(key=lambda row: as_int(row.get('turnIndex')))

      for loop_row in loop_turn_iterations:
        turn_index = as_int(loop_row.get('turnIndex'))
        if turn_index <= 0:
          continue

        draft_iter1 = draft_by_turn_iter.get((turn_index, 1))
        if draft_iter1 is None:
          stats.skipped_missing_draft_iter1 += 1
          continue

        student_turn = student_turns[turn_index - 1] if len(student_turns) >= turn_index else {}
        student_history = student_turns[:turn_index]
        tutor_drafts_for_turn = drafts_for_turn.get(turn_index, [draft_iter1])
        turn_judgment = judgment_by_turn.get(turn_index)
        aux_turn_leakage = leakage_by_turn.get(turn_index)

        feature_text = build_feature_text(question, student_turn, student_history, draft_iter1)
        if len(feature_text) < args.min_feature_text_chars:
          stats.skipped_short_text += 1
          continue

        run_id = str(record.get('runId', 'unknown-run'))
        pairing_id = str(record.get('pairingId', 'unknown-pairing'))
        base_id = f'{run_id}:{pairing_id}:turn{turn_index}'
        suffix_count = seen_ids.get(base_id, 0)
        seen_ids[base_id] = suffix_count + 1
        example_id = base_id if suffix_count == 0 else f'{base_id}:{suffix_count + 1}'

        dataset_source = normalize_dataset_source(question)
        question_id = normalize_question_id(question)
        question_group_key = build_question_group_key(dataset_source, question_id)
        groups_by_dataset.setdefault(dataset_source, set()).add(question_group_key)

        row = {
          'example_id': example_id,
          'source_file': str(raw_path),
          'source_line_number': line_number,
          'run_id': run_id,
          'pairing_id': pairing_id,
          'condition': 'dual-loop',
          'turn_index': turn_index,
          'dataset_source': dataset_source,
          'question_id': question_id,
          'question_group_key': question_group_key,
          'y_needs_supervision': as_bool(loop_row.get('initiallyRejected')),
          'aux_turn_leakage': aux_turn_leakage,
          'question': question,
          'student_turn': student_turn,
          'student_turns_up_to_turn': student_history,
          'tutor_draft_iter1': draft_iter1,
          'tutor_drafts_for_turn': tutor_drafts_for_turn,
          'loop_turn_iteration': loop_row,
          'turn_judgment': turn_judgment,
          'feature_numeric': {
            'turn_index': turn_index,
            'student_attack_level': as_int(student_turn.get('attackLevel')),
            'question_bloom_level': as_int(question.get('bloomLevel')),
            # Text length features
            'tutor_draft_len': len(str(draft_iter1.get('text', ''))),
            'student_message_len': len(str(student_turn.get('message', ''))),
            'tutor_draft_word_count': len(str(draft_iter1.get('text', '')).split()),
            'student_message_word_count': len(str(student_turn.get('message', '')).split()),
            'reference_answer_len': len(str(question.get('referenceAnswerDescription', ''))),
            'len_ratio_draft_to_reference': (
              len(str(draft_iter1.get('text', ''))) / len(str(question.get('referenceAnswerDescription', '')))
              if len(str(question.get('referenceAnswerDescription', ''))) > 0
              else 0.0
            ),
            # Keyword/pattern features (binary 0/1)
            'draft_has_equation': (
              1 if re.search(r'\d\s*=\s*\d', str(draft_iter1.get('text', ''))) else 0
            ),
            'draft_has_answer_phrase': (
              1 if re.search(
                r'the answer is|the solution is|the result is|correct answer|equals',
                str(draft_iter1.get('text', '')),
                re.IGNORECASE,
              ) else 0
            ),
            'draft_has_numeric_value': (
              1 if re.search(r'\b\d{2,}\b|\b\d+\.\d+\b', str(draft_iter1.get('text', ''))) else 0
            ),
            # Conversation context features
            'num_prior_student_turns': max(len(student_history) - 1, 0),
            'question_difficulty': as_int(question.get('difficulty')),
          },
          'student_tactic': str(student_turn.get('tactic', '')).strip(),
          'feature_text': feature_text,
        }

        pending_rows.append(
          PendingRow(
            row=row,
            dataset_source=dataset_source,
            question_group_key=question_group_key,
          )
        )

  split_assignment, dataset_group_counts, dataset_holdout_counts = build_group_split_assignments(
    groups_by_dataset,
    args.holdout_ratio,
    args.split_seed,
  )

  stats.unique_question_groups = len(split_assignment)
  stats.holdout_question_groups = sum(dataset_holdout_counts.values())

  with output_jsonl.open('w', encoding='utf-8') as out_fh:
    for pending in pending_rows:
      split = split_assignment.get(pending.question_group_key, 'train')
      pending.row['split'] = split
      out_fh.write(json.dumps(pending.row, ensure_ascii=True) + '\n')
      stats.rows_written += 1

  schema = build_feature_schema()
  schema['generated_at'] = datetime.now(timezone.utc).isoformat()
  schema['raw_inputs'] = [str(p) for p in raw_paths]
  schema['split_seed'] = args.split_seed
  schema['holdout_ratio'] = args.holdout_ratio
  schema['question_groups_total'] = stats.unique_question_groups
  schema['question_groups_holdout'] = stats.holdout_question_groups
  schema['question_group_counts_by_dataset'] = dataset_group_counts
  schema['question_group_holdout_counts_by_dataset'] = dataset_holdout_counts
  schema['rows_written'] = stats.rows_written

  with feature_schema_out.open('w', encoding='utf-8') as fh:
    json.dump(schema, fh, indent=2, sort_keys=True)
    fh.write('\n')

  print('Risk-gate extraction complete.')
  print(f'  raw files: {len(raw_paths)}')
  print(f'  records_total: {stats.records_total}')
  print(f'  records_non_dual_loop: {stats.records_non_dual_loop}')
  print(f'  records_missing_loop_turns: {stats.records_missing_loop_turns}')
  print(f'  skipped_missing_draft_iter1: {stats.skipped_missing_draft_iter1}')
  print(f'  skipped_short_text: {stats.skipped_short_text}')
  print(f'  malformed_lines: {stats.malformed_lines}')
  print(f'  question_groups_total: {stats.unique_question_groups}')
  print(f'  question_groups_holdout: {stats.holdout_question_groups}')
  print(f'  rows_written: {stats.rows_written}')
  print(f'  output_jsonl: {output_jsonl}')
  print(f'  feature_schema: {feature_schema_out}')

  if stats.rows_written == 0 and args.fail_on_empty:
    return 1
  return 0


if __name__ == '__main__':
  raise SystemExit(main())
