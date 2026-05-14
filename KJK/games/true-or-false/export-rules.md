# True or False – CSV Export Rules

These rules describe how to convert structured objects for the **“True or False”** game into CSV rows.

1. **Header:** Use the standard 31‑column header as the first row of the CSV.

2. **Fixed fields:** For every row set:
   * `Sheet` = **"True or False"**
   * `Game`  = **"True or False"**
   * `Active` = **"Yes"**
   * `Source Label` = **"generated:True or False"**
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

4. **Options and correct answer:** Write `Options` and `Correct Answer` columns as empty.  Do not insert “True” or “False”.

5. **Quoting:** Escape any field containing commas, quotes or line breaks by wrapping it in double quotes and doubling any internal quotes.

6. **Column count:** Ensure each row has exactly 31 cells.  Do not omit trailing empty columns.

7. **Order:** Maintain the order of questions from the generation when exporting.