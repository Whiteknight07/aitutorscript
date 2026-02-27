# Inferential Statistics Summary

Inputs:
- Raw tutoring log: `/root/clawd/code/aitutorscript/results/run_2026-02-24T23-50-44-586Z_merged_2026-02-26T22-58-06-051Z/raw.jsonl`
- Closed-book file: `/root/clawd/code/aitutorscript/results/mcq_accuracy_2026-02-24T04-24-19-103Z.jsonl`

## Single vs Dual Leakage

| Tutor | Source | Comparison | Single | Dual | Discordant (single only / dual only) | p_raw | p_Holm |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GPT | CSBench | Single vs Dual/GPT | 102/644 (15.8%) | 24/644 (3.7%) | 90 / 12 | 6.13e-16 | 3.68e-15 |
| GPT | CSBench | Single vs Dual/Gemini | 102/644 (15.8%) | 27/644 (4.2%) | 92 / 17 | 1.23e-13 | 6.13e-13 |
| GPT | PeerWise | Single vs Dual/GPT | 175/779 (22.5%) | 16/779 (2.1%) | 168 / 9 | 4.21e-39 | 3.37e-38 |
| GPT | PeerWise | Single vs Dual/Gemini | 175/779 (22.5%) | 28/779 (3.6%) | 168 / 21 | 1.15e-29 | 8.03e-29 |
| Gemini | CSBench | Single vs Dual/Gemini | 39/644 (6.1%) | 17/644 (2.6%) | 36 / 14 | 0.0026 | 0.0026 |
| Gemini | CSBench | Single vs Dual/GPT | 39/644 (6.1%) | 10/644 (1.6%) | 37 / 8 | 1.54e-05 | 4.61e-05 |
| Gemini | PeerWise | Single vs Dual/Gemini | 50/779 (6.4%) | 16/779 (2.1%) | 48 / 14 | 1.74e-05 | 4.61e-05 |
| Gemini | PeerWise | Single vs Dual/GPT | 50/779 (6.4%) | 15/779 (1.9%) | 47 / 12 | 5.13e-06 | 2.05e-05 |

## Source-Level Closed-Book Accuracy

| Tutor | CSBench | PeerWise | Gap | p_raw | p_Holm |
| --- | --- | --- | --- | --- | --- |
| GPT | 490/644 (76.1%) | 410/779 (52.6%) | 23.5% | 3.00e-20 | 3.00e-20 |
| Gemini | 575/644 (89.3%) | 520/779 (66.8%) | 22.5% | 7.58e-25 | 1.52e-24 |

## Single-Tutor Correctness-Conditioned Leakage

| Tutor | Source | Closed-book correct | Closed-book wrong | p_raw | p_Holm |
| --- | --- | --- | --- | --- | --- |
| GPT | CSBench | 82/490 (16.7%) | 20/154 (13.0%) | 0.3119 | 0.9357 |
| GPT | PeerWise | 92/410 (22.4%) | 83/369 (22.5%) | 1.0000 | 1.0000 |
| Gemini | CSBench | 32/575 (5.6%) | 7/69 (10.1%) | 0.1740 | 0.6961 |
| Gemini | PeerWise | 30/520 (5.8%) | 20/259 (7.7%) | 0.3516 | 0.9357 |

