# Most Likely To – CSV Export Rules

Use these rules to convert structured objects for the **“Most Likely To”** game into CSV rows.

1. **Header:** The first row must be the standard 31‑column header.

2. **Fixed fields:** For each row set:
   * `Sheet` = **"Most Like To"**
   * `Game` = **"Most Likely To"**
   * `Active` = **"Yes"**
   * `Source Label` = **"generated:Most Likely To"**
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

4. **Options and correct answer:** Leave `Options` and `Correct Answer` blank for every row.

5. **Quoting:** Wrap any field containing a comma, quote or newline in double quotes and escape internal quotes by doubling them.

6. **Column count:** Each row must contain exactly 31 cells.  Do not add or remove columns.

7. **Order:** Preserve the order of generated questions when exporting.