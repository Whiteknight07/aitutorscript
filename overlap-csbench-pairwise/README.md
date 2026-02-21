# overlap-csbench-pairwise

This folder stores the mixed overlap dataset used to run the harness on only the shared CSBench/Pairwise concept coverage.

## Files

- `questions.json`  
  Combined question set with:
  - `dataset` preserved as `csbench` or `pairwise`
  - `source` set to `csbench` or `pairwise` on every question
  - original per-question metadata preserved (`csbench` block for CSBench, `metadata` block for Pairwise)
  - overlap metadata (`sharedBroadConcepts`, `overlapMetadata`, counts)

## Regenerate

```bash
pnpm build:overlap-dataset
```

## Run harness on overlap-only questions

```bash
pnpm harness:overlap -- --maxRuns 50 --turns 4
```
