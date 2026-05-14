# This or That – CSV Export Rules

This game uses only preference questions.  Use these rules to build the CSV:

1. **Header:** Use the standard 31‑column header as the first row.

2. **Fixed fields:** Set `Sheet` = **"This or That"**, `Game` = **"This or That"**, `Active` = **"Yes"**, `Source Label` = **"generated:This or That"**, and `Added By` = **"ChatGPT"**.  Scoring columns remain blank.

3. **Mapping:** Map the JSON fields to CSV columns:

| JSON key           | CSV column             |
|--------------------|-------------------------|
| `question`         | Question               |
| `category`         | Category               |
| `questionType`     | Question Type          |
| `options`          | Options                |
| `correctAnswer`    | Correct Answer         |
| `intensity`        | Intensity              |
| `tone`             | Tone                   |
| `relationshipArea` | Relationship Area      |
| `tags`             | Tags                   |
| `notes`            | Notes                  |
| `memoryLaneMode`   | Memory Lane Mode       |
| `avoidIf`          | Avoid If               |
| `gameSuitability`  | Game Suitability       |
| `aiUseCase`        | AI Use Case            |
| `repeatGroup`      | Repeat Group           |
| `defaultAnswerType`| Default Answer Type    |
| `answerType`       | Answer Type            |
| `unitLabel`        | Unit Label             |
| (scoring fields)   | Scoring columns        |
| `originalSheet`    | Original Sheet         |
| `originalQuestionType` | Original Question Type |

4. **Options formatting:** Write `options` exactly as provided (pipe‑separated).  For this game, options must never be blank.

5. **Correct answer:** Leave `Correct Answer` blank for every row.

6. **Quoting:** Escape fields with commas, quotes or newlines per CSV rules.

7. **Column count:** Each row must contain 31 cells.

8. **Order:** Maintain the original order of questions when exporting.