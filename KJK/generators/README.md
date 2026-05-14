# Generators

This directory provides guidance for building and using GPT‑based generators to create structured question objects for KJK games.

## Principles

1. **Separate creativity from validation** – The generator produces JSON objects adhering to the game’s schema.  It does not attempt to format CSV or implement complex validation logic.  Validation and export are handled by separate modules.
2. **Compact instructions** – Each game folder contains `instructions.md`, a concise prompt which tells the GPT model how to generate questions, enforce allowed question types and categories, vary tone and intensity, avoid duplicates, and respect game‑specific rules (e.g. fixed choices).  Avoid giant monolithic prompts; keep instructions maintainable.
3. **Structured output** – The generator returns an array of JSON objects (or one object at a time) following the schema in `schema.json`.  Keys must be spelled exactly, even if a field is optional.
4. **Distribution requirements** – When the generator is asked to produce a batch, it should satisfy the distribution rules (e.g. minimum variety of categories, question types, tones).  These requirements are described in `validator-rules.md` and may be reiterated in the instructions.

In future iterations, generators can be augmented with retrieval‑based prompts, memory of past generated content, and embeddings to avoid duplication.  They should also integrate with analytics to balance question coverage and difficulty.