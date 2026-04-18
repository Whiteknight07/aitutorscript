# Publication Bundle

This folder contains the public 900-run dataset bundle for the paper release.

Contents:

- `run-config.json`: run arguments and environment summary
- `questions.json`: question set used for the run
- `summary.json`: aggregate run metrics
- `analysis.json`: richer analysis tables
- `raw.jsonl.gz`: gzipped raw per-conversation log
- `report.html.gz`: gzipped self-contained report
- `SHA256SUMS`: checksums for the bundled files

Provenance:

- Source run: `results/run_2026-02-01T12-30-58-782Z`
- Dataset: `canterbury`
- Questions: `150`
- Conversations: `900`

The compressed artifacts are byte-for-byte gzip outputs of the local source files so they can be stored in GitHub without exceeding repository file size limits.
