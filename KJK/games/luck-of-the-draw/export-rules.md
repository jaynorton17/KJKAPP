# Put Your Points Where Your Mouth Is – CSV Export Rules

The exporter takes validated question objects and writes them to a CSV row that matches the upload template for this game.  Follow these rules to ensure a correct, import‑ready file.

1. **Header row:** Always write the following header as the first row of the CSV:

   `Sheet,Game,Question,Category,Question Type,Options,Correct Answer,Active,Intensity,Tone,Relationship Area,Tags,Notes,Memory Lane Mode,Avoid If,Game Suitability,AI Use Case,Repeat Group,Default Answer Type,Answer Type,Unit Label,Scoring Divisor,Rounding Mode,Round Penalty Value,Fixed Penalty,Scoring Mode,Scoring Outcome Type,Source Label,Added By,Original Sheet,Original Question Type`

2. **Fixed values:** Fill the `Sheet` column with **"Put Your Money Where Your Mouth Is"**, `Game` with **"Put Your Points Where Your Mouth Is"**, `Active` with **"Yes"**, `Source Label` with **"generated:Put Your Points"**, `Added By` with **"ChatGPT"**.  Scoring columns must be filled with the constants defined in the schema: `Scoring Divisor` = 1, `Rounding Mode` = `nearest`, `Round Penalty Value` = 5, `Fixed Penalty` = 5, `Scoring Mode` = `direct_penalty_entry`, `Scoring Outcome Type` = `exact_match_else_fixed_penalty`.

3. **Mapping fields:** Map each property of the question object to its corresponding column:

| Object key          | CSV column          |
|---------------------|---------------------|
| `question`          | Question            |
| `category`          | Category            |
| `questionType`      | Question Type       |
| `options`           | Options             |
| `correctAnswer`     | Correct Answer      |
| `intensity`         | Intensity           |
| `tone`              | Tone                |
| `relationshipArea`  | Relationship Area   |
| `tags`              | Tags                |
| `notes`             | Notes               |
| `memoryLaneMode`    | Memory Lane Mode    |
| `avoidIf`           | Avoid If            |
| `gameSuitability`   | Game Suitability    |
| `aiUseCase`         | AI Use Case         |
| `repeatGroup`       | Repeat Group        |
| `defaultAnswerType` | Default Answer Type |
| `answerType`        | Answer Type         |
| `unitLabel`         | Unit Label          |
| (scoring fields)    | Scoring columns     |
| `originalSheet`     | Original Sheet      |
| `originalQuestionType` | Original Question Type |

4. **Blank values:** For optional properties that are absent or empty, write an empty string in the CSV cell.  Do not write `null`, `N/A` or any placeholder.

5. **Options formatting:** When `options` is not empty, join the array into a single string separated by ` | `.  Ensure no extra spaces at the beginning or end.  When `options` is empty (fixed‑choice questions), leave the cell blank.

6. **CSV quoting:** If any field contains a comma, double quote or newline, wrap the entire field in double quotes.  Escape internal quotes by doubling them.  Encourage the generator to avoid commas in question text to reduce quoting.

7. **Column count:** Each data row must have exactly 31 cells, matching the header.  Do not add or omit columns.

8. **Order preservation:** Export objects in the order they were generated.  Do not sort or reorder rows.

Following these rules ensures the exported CSV will be accepted by the KJK admin system without manual adjustment.