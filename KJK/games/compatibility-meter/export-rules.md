# Compatibility Meter – CSV Export Rules

Follow these rules to map structured objects for the **“Compatibility Meter”** game into CSV rows.

1. **Header:** Start the CSV with the standard 31‑column header.

2. **Fixed fields:** For every row set:
   * `Sheet` = **"Compatibility"**
   * `Game`  = **"Compatibility Meter"**
   * `Active` = **"Yes"**
   * `Source Label` = **"generated:Compatibility Meter"**
   * `Added By` = **"ChatGPT"**
   * Leave all scoring fields blank.

3. **Mapping:** Map JSON keys to CSV columns according to the mapping below:

| JSON key             | CSV column             |
|----------------------|-------------------------|
| `question`           | Question               |
| `category`           | Category               |
| `questionType`       | Question Type          |
| `options`            | Options                |
| `correctAnswer`      | Correct Answer         |
| `intensity`          | Intensity              |
| `tone`               | Tone                   |
| `relationshipArea`   | Relationship Area      |
| `tags`               | Tags                   |
| `notes`              | Notes                  |
| `memoryLaneMode`     | Memory Lane Mode       |
| `avoidIf`            | Avoid If               |
| `gameSuitability`    | Game Suitability       |
| `aiUseCase`          | AI Use Case            |
| `repeatGroup`        | Repeat Group           |
| `defaultAnswerType`  | Default Answer Type    |
| `answerType`         | Answer Type            |
| `unitLabel`          | Unit Label             |
| (scoring fields)     | Scoring columns        |
| `originalSheet`      | Original Sheet         |
| `originalQuestionType` | Original Question Type |

4. **Options formatting:** Write the `Options` cell exactly as provided (pipe‑separated) for choice‑based rows.  For free‑text, numeric, rating and true/false rows, leave `Options` blank.  Do not add Jay, Kim or other player names.

5. **Correct answer:** Leave the `Correct Answer` column blank for every row.

6. **Quoting:** If any field contains commas, quotes or newlines, wrap it in double quotes and double any internal quotes.

7. **Column count:** Each row must contain exactly 31 cells.  Do not omit trailing empty cells.

8. **Order:** Preserve the order of the generated questions when exporting.