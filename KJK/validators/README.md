# Validators

Each game in the KJK system is accompanied by a `validator-rules.md` file that outlines a deterministic checklist for checking structured question objects before export.  Validators must not rely on statistical models or heuristics; instead they enforce objective rules such as required fields, allowed enumerations, option uniqueness, and duplicate detection.

## Core Responsibilities

- **Required fields** – Ensure that mandatory properties (e.g. `question`, `questionType`, `category`, `tone`, `active`) are present and not empty.
- **Fixed values** – Verify that fields such as `sheet` and `game` exactly match the fixed values defined in the schema.
- **Enumerations** – Check that enumerated properties (question type, category, tone, intensity, relationship area, default answer type, answer type) are members of the allowed sets.
- **Options rules** – For choice‑based question types, ensure options are present, pipe‑separated and unique.  For fixed‑choice games (True or False, Who’s More Likely To, Red Flag Green Flag), ensure the `options` and `correctAnswer` fields are blank.
- **Answer mappings** – Validate that `defaultAnswerType` and `answerType` match the question type as specified in the schema mappings.
- **Duplicate prevention** – Reject objects with duplicate or near‑duplicate question text or overlapping option sets within the same batch or across previous data.  This can be extended with embeddings or string similarity metrics in the future.
- **Distribution checks** – Enforce any batch‑level requirements (minimum number of question types, categories, tones, intensities) defined by the game.

Validators should produce deterministic pass/fail results and a list of error messages for each failed check.  They can be implemented as simple Python functions or CLI tools that consume JSON objects and the corresponding schema.