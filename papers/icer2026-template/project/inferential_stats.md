# Inferential Statistics Summary

Inputs:
- Raw tutoring log: `/root/clawd/code/aitutorscript/results/run_2026-02-24T23-50-44-586Z_merged_2026-02-26T22-58-06-051Z/raw.jsonl`
- Closed-book file: `/root/clawd/code/aitutorscript/results/mcq_accuracy_2026-02-24T04-24-19-103Z.jsonl`

## Effect-Size Conventions

### `single_vs_dual_leakage`

- Primary effect size: Matched odds ratio (single / dual leakage odds among discordant question pairs)
- 95% CI method: Exact Clopper-Pearson interval on the discordant-pair binomial proportion, transformed to an odds ratio
- Rationale: The question-paired design and exact McNemar test are identified by the discordant pairs only, so the matched odds ratio is the natural primary effect size for the main supervision comparison.
- Secondary context: Absolute leakage-rate drops are retained as descriptive percentages.

### `source_accuracy`

- Primary effect size: Absolute accuracy gap (CSBench - PeerWise)
- 95% CI method: Newcombe-Wilson score interval for the difference between independent proportions
- Rationale: The claim is explicitly about how many percentage points accuracy drops from CSBench to PeerWise, so an absolute gap is more interpretable than a ratio-based effect size here.

### `single_tutor_correctness_conditioned_leakage`

- Primary effect size: Absolute leakage gap (closed-book correct - closed-book wrong)
- 95% CI method: Newcombe-Wilson score interval for the difference between independent proportions
- Rationale: These within-cell contrasts are descriptive and some wrong-answer cells are modest, so a percentage-point leakage gap is the clearest measure of substantive contrast without overstating small-cell ratios.

## Single vs Dual Leakage

| Tutor | Source | Comparison | Single | Dual | Discordant (single only / dual only) | Matched OR (95% CI) | Rate drop | p_raw | p_Holm |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GPT | CSBench | Single vs Dual/GPT | 102/644 (15.8%) | 24/644 (3.7%) | 90 / 12 | 7.50 [4.09, 15.05] | +12.1 pp | 6.13e-16 | 3.68e-15 |
| GPT | CSBench | Single vs Dual/Gemini | 102/644 (15.8%) | 27/644 (4.2%) | 92 / 17 | 5.41 [3.20, 9.69] | +11.6 pp | 1.23e-13 | 6.13e-13 |
| GPT | PeerWise | Single vs Dual/GPT | 175/779 (22.5%) | 16/779 (2.1%) | 168 / 9 | 18.67 [9.60, 41.53] | +20.4 pp | 4.21e-39 | 3.37e-38 |
| GPT | PeerWise | Single vs Dual/Gemini | 175/779 (22.5%) | 28/779 (3.6%) | 168 / 21 | 8.00 [5.07, 13.26] | +18.9 pp | 1.15e-29 | 8.03e-29 |
| Gemini | CSBench | Single vs Dual/Gemini | 39/644 (6.1%) | 17/644 (2.6%) | 36 / 14 | 2.57 [1.35, 5.16] | +3.4 pp | 0.0026 | 0.0026 |
| Gemini | CSBench | Single vs Dual/GPT | 39/644 (6.1%) | 10/644 (1.6%) | 37 / 8 | 4.62 [2.12, 11.50] | +4.5 pp | 1.54e-05 | 4.61e-05 |
| Gemini | PeerWise | Single vs Dual/Gemini | 50/779 (6.4%) | 16/779 (2.1%) | 48 / 14 | 3.43 [1.86, 6.73] | +4.4 pp | 1.74e-05 | 4.61e-05 |
| Gemini | PeerWise | Single vs Dual/GPT | 50/779 (6.4%) | 15/779 (1.9%) | 47 / 12 | 3.92 [2.05, 8.11] | +4.5 pp | 5.13e-06 | 2.05e-05 |

## Source-Level Closed-Book Accuracy

| Tutor | CSBench | PeerWise | Accuracy gap (95% CI) | p_raw | p_Holm |
| --- | --- | --- | --- | --- | --- |
| GPT | 490/644 (76.1%) | 410/779 (52.6%) | +23.5 pp [18.6, 28.2] | 3.00e-20 | 3.00e-20 |
| Gemini | 575/644 (89.3%) | 520/779 (66.8%) | +22.5 pp [18.4, 26.5] | 7.58e-25 | 1.52e-24 |

## Single-Tutor Correctness-Conditioned Leakage

| Tutor | Source | Closed-book correct | Closed-book wrong | Correct - wrong gap (95% CI) | p_raw | p_Holm |
| --- | --- | --- | --- | --- | --- | --- |
| GPT | CSBench | 82/490 (16.7%) | 20/154 (13.0%) | +3.7 pp [-3.2, 9.4] | 0.3119 | 0.9357 |
| GPT | PeerWise | 92/410 (22.4%) | 83/369 (22.5%) | -0.1 pp [-5.9, 5.8] | 1.0000 | 1.0000 |
| Gemini | CSBench | 32/575 (5.6%) | 7/69 (10.1%) | -4.6 pp [-14.1, 1.0] | 0.1740 | 0.6961 |
| Gemini | PeerWise | 30/520 (5.8%) | 20/259 (7.7%) | -2.0 pp [-6.2, 1.6] | 0.3516 | 0.9357 |

