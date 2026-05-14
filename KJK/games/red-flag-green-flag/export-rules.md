# Red Flag Green Flag – CSV Export Rules

Follow these rules to convert structured objects for the **“Red Flag Green Flag”** game into CSV rows.

1. **Header:** The first row must be the standard 31‑column header.

2. **Fixed fields:** For each data row set:
   * `Sheet` = **"Red Flag Green Flag"**
   * `Game`  = **"Red Flag Green Flag"**
   * `Active` = **"Yes"**
   * `Source Label` = **"generated:Red Flag Green Flag"**
   * `Added By` = **"ChatGPT"**
   * Leave all scoring fields blank.

3. **Mapping:** Map JSON keys to CSV columns as follows:

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

4. **Options and correct answer:** Leave both columns empty for every row.

5. **Quoting:** Escape any field with commas, quotes or newlines by wrapping it in double quotes and doubling any internal quotes.

6. **Column count:** Ensure each row has exactly 31 cells.  Do not omit trailing empty columns.

7. **Order:** Preserve the generation order when exporting.