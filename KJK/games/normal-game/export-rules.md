# Normal Game – CSV Export Rules

This file explains how to convert validated Normal Game question objects into CSV rows that match the KJK upload template.

1. **Header row:** The first row of the CSV must be exactly:

   `Sheet,Game,Question,Category,Question Type,Options,Correct Answer,Active,Intensity,Tone,Relationship Area,Tags,Notes,Memory Lane Mode,Avoid If,Game Suitability,AI Use Case,Repeat Group,Default Answer Type,Answer Type,Unit Label,Scoring Divisor,Rounding Mode,Round Penalty Value,Fixed Penalty,Scoring Mode,Scoring Outcome Type,Source Label,Added By,Original Sheet,Original Question Type`

2. **Fixed columns:** Fill `Sheet` with **"Questions"** and `Game` with **"Normal Game"**.  Set `Active` to **"Yes"**, `Source Label` to **"generated:Normal Game"**, and `Added By` to **"ChatGPT"**.  The six scoring columns (`Scoring Divisor`, `Rounding Mode`, `Round Penalty Value`, `Fixed Penalty`, `Scoring Mode`, `Scoring Outcome Type`) should remain blank because the Normal Game does not use scoring.

3. **Property mapping:** Assign object properties to CSV columns as follows:

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

4. **Empty cells:** For any optional property that is absent or empty, output an empty string in the corresponding CSV cell.  Do not write `null`, `N/A`, or placeholder text.

5. **Options formatting:** Join `options` with ` | ` (spaces around the pipe).  For fixed‑choice types (True or False, Who is more likely to), leave the Options column blank.

6. **CSV quoting:** If a value contains a comma, double quote or newline, wrap the entire field in double quotes and escape internal quotes by doubling them.  Encourage generators to avoid commas in the question text when practical.

7. **Column count:** Ensure each data row has exactly 31 columns.  Do not drop trailing blanks or add extra columns.

8. **Order:** Export objects in the order provided.  Do not reorder rows.