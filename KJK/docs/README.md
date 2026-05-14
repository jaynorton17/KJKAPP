# KJK AI Content Generation System

This repository contains the structured architecture and resources for generating question banks for all KJK games.  Each game lives in its own folder under `games/` with machine‑readable schemas, compact GPT instructions, validation rules, and export guidelines.  The top‑level `validators/`, `exporters/` and `generators/` directories describe the generic components used across games.

## Directory Layout

```
KJK/
├── games/                 # One subfolder per supported game
│   ├── how-sure-are-you/
│   ├── normal-game/
│   ├── quick-fire-quiz/
│   ├── this-or-that/
│   ├── put-your-points-where-your-mouth-is/
│   ├── memory-lane/
│   ├── true-or-false/
│   ├── whos-more-likely-to/
│   ├── red-flag-green-flag/
│   └── compatibility-meter/
├── validators/            # Guidance for building deterministic validators
├── exporters/             # Guidance for exporting structured objects to CSV
├── generators/            # Overview of generation prompts and future automation
└── docs/                  # High‑level documentation (this file)
```

Each game folder contains:

- `schema.json` – A machine‑readable definition of the question object structure, fixed values, allowed enumerations and answer type mappings.
- `instructions.md` – A compact instruction set for the GPT responsible for generating structured question objects for the game.
- `export-rules.md` – A description of how to transform a validated question object into a CSV row.
- `validator-rules.md` – The deterministic rules used to validate generated objects before they are exported.
- `structured-object-example.json` – An example of a valid structured object for the game.
- `original-prompt.txt` – The current generation prompt/specification used by the legacy system for reference.
- `upload-template.csv` – A blank CSV with the correct header for the game.
- `existing-questions.csv` – A CSV containing the existing questions loaded in the system (header only if unavailable).
- `remaining-questions.csv` – A CSV containing the remaining unused questions in the system (header only if unavailable).

This architecture moves away from single monolithic prompts towards a maintainable pipeline: GPT → structured object → validation → export.  New question rows are generated as JSON objects conforming to a schema, checked deterministically, and then exported to CSV for upload.  The design emphasises modularity, duplication prevention, and future automation such as embedding‑based similarity checks and analytics.

## Implemented services

- `../generators/service.mjs` normalizes raw GPT JSON arrays into canonical KJK question objects.
- `../validators/service.mjs` is the deterministic source of truth for schema, game-rule, quality, and distribution validation.
- `../exporters/service.mjs` exports validated objects to CSV using each game's `upload-template.csv` header as the source of truth.
- `../process-structured-batch.mjs` runs the pipeline end to end and emits a failed-row regeneration plan when validation does not pass.

See [pipeline.md](./pipeline.md) for usage details.
