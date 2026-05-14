# Structured Question Pipeline

This pipeline keeps the current CSV upload flow intact while moving generation to structured JSON:

`GPT -> JSON objects -> validator -> CSV exporter -> existing upload pipeline`

## Implemented modules

- `KJK/generators/service.mjs`
  Accepts raw JSON arrays or JSON files, normalizes field aliases, fills schema const values, derives answer-type mappings, and caps generation batches at 20 objects.
- `KJK/validators/service.mjs`
  Validates schema shape, fixed values, enums, null handling, answer mappings, fixed-choice rules, option rules, duplicate wording, near-duplicates, repeated option pools, repeated openings, and batch distribution.
- `KJK/exporters/service.mjs`
  Uses each game's `upload-template.csv` as the source of truth for exact column order and exports upload-ready CSV with correct quoting and trailing empty fields preserved.
- `KJK/process-structured-batch.mjs`
  End-to-end CLI that reads generated JSON, validates it, and either prints a structured failure report with a failed-row regeneration plan or emits a compatible CSV.

## CLI usage

```bash
node KJK/process-structured-batch.mjs normal-game ./batch.json ./batch.csv
node KJK/process-structured-batch.mjs memory-lane ./failed-rows.json ./failed-rows.csv --regeneration
```

If validation fails, the CLI exits with code `2` and prints:

- batch-level distribution failures
- per-row validation failures
- a regeneration payload that targets only failed rows

This is the handoff point back to GPT for selective row regeneration.
