# How Sure Are You? – CSV Export Rules

To build an upload‑ready CSV from validated “How Sure Are You?” question objects, follow these mapping rules.

1. **Header row:** Always include the following header as the first row:

   `Sheet,Game,Question,Category,Question Type,Options,Correct Answer,Active,Intensity,Tone,Relationship Area,Tags,Notes,Memory Lane Mode,Avoid If,Game Suitability,AI Use Case,Repeat Group,Default Answer Type,Answer Type,Unit Label,Scoring Divisor,Rounding Mode,Round Penalty Value,Fixed Penalty,Scoring Mode,Scoring Outcome Type,Source Label,Added By,Original Sheet,Original Question Type`

2. **Fixed values:** Set `Sheet` to **"How Sure Are You"**, `Game` to **"How Sure Are You?"**, `Active` to **"Yes"**, `Source Label` to **"generated:How Sure Are You"**, `Added By` to **"ChatGPT"**, and populate scoring columns with constants: `Scoring Divisor` = 1, `Rounding Mode` = `nearest`, `Round Penalty Value` = 5, `Fixed Penalty` = 5, `Scoring Mode` = `direct_penalty_entry`, `Scoring Outcome Type` = `exact_match_else_fixed_penalty`.

3. **Field mapping:** Map each property of the question object to its CSV column as follows:

| Object key             | CSV column             |
|------------------------|------------------------|
| `question`             | Question               |
| `category`             | Category               |
| `questionType`         | Question Type          |
| `options`              | Options                |
| `correctAnswer`        | Correct Answer         |
| `intensity`            | Intensity              |
| `tone`                 | Tone                   |
| `relationshipArea`     | Relationship Area      |
| `tags`                 | Tags                   |
| `notes`                | Notes                  |
| `memoryLaneMode`       | Memory Lane Mode       |
| `avoidIf`              | Avoid If               |
| `gameSuitability`      | Game Suitability       |
| `aiUseCase`            | AI Use Case            |
| `repeatGroup`          | Repeat Group           |
| `defaultAnswerType`    | Default Answer Type    |
| `answerType`           | Answer Type            |
| `unitLabel`            | Unit Label             |
| (scoring fields)       | Scoring columns        |
| `originalSheet`        | Original Sheet         |
| `originalQuestionType` | Original Question Type |

4. **Blank fields:** Write an empty string in any CSV cell corresponding to a missing optional property.  Do not insert `null` or other markers.

5. **Options formatting:** For choice‑based questions, join the `options` array using ` | ` (spaces around the pipe).  For fixed‑choice types (True or False, Who is more likely to), leave `Options` blank.

6. **CSV quoting:** If a field contains a comma, double quote or newline, wrap it in double quotes and escape internal quotes by doubling them.  Encourage the generator to avoid commas in question text when possible.

7. **Column count:** Each data row must have exactly 31 comma‑separated cells.  Do not add extra columns or omit trailing blanks.

8. **Order:** Preserve the order of questions in the exported file.  Do not sort or rearrange rows.

Following these rules ensures the CSV conforms to the upload requirements of the KJK admin system.