# Exporters

Exporters transform validated structured question objects into CSV rows suitable for upload to the KJK admin portal.  Each game folder includes an `export-rules.md` file which describes how to map the properties of a question object into the 31‑column CSV header shared across games.

## Responsibilities

1. **Column ordering** – Ensure that every exported CSV row includes exactly the 31 columns specified by the header: `Sheet,Game,Question,Category,Question Type,Options,Correct Answer,Active,Intensity,Tone,Relationship Area,Tags,Notes,Memory Lane Mode,Avoid If,Game Suitability,AI Use Case,Repeat Group,Default Answer Type,Answer Type,Unit Label,Scoring Divisor,Rounding Mode,Round Penalty Value,Fixed Penalty,Scoring Mode,Scoring Outcome Type,Source Label,Added By,Original Sheet,Original Question Type`.
2. **Value mapping** – Insert fixed values (sheet, game, active, addedBy, sourceLabel) directly from the schema.  Use the generated values from the object for `question`, `category`, `questionType`, `options`, `correctAnswer`, `intensity`, `tone`, `relationshipArea`, `tags`, `notes`, `memoryLaneMode`, `avoidIf`, `gameSuitability`, `aiUseCase`, `repeatGroup`, `defaultAnswerType`, `answerType`, `unitLabel`, `scoringDivisor`, `roundingMode`, `roundPenaltyValue`, `fixedPenalty`, `scoringMode`, `scoringOutcomeType`.
3. **CSV formatting** – Ensure that each row has exactly 31 comma‑separated cells.  Wrap any cell containing a comma, quote or line break in double quotes and escape internal quotes by doubling them.  Leave unused optional fields as empty strings, not as `null` or placeholder text.
4. **Batch export** – For a batch of N question objects, produce a CSV file with one header row and N data rows, preserving order.

Exporters should be stateless; they assume that all incoming objects have passed validation and focus solely on correct formatting and mapping.