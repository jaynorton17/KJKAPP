# Memory Lane – CSV Export Rules

These rules describe how to convert structured objects for the **“Memory Lane”** game into CSV rows.

1. **Header:** Start the CSV with the standard 31‑column header.

2. **Fixed fields:** For each row set:
   * `Sheet` = **"Memory Lane"**
   * `Game`  = **"Memory Lane"**
   * `Active` = **"Yes"**
   * `Source Label` = **"generated:Memory Lane"**
   * `Added By` = **"ChatGPT"**
   * Leave all scoring fields blank.

3. **Mapping:** Map JSON keys to CSV columns as follows:

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

4. **Options and correct answer:**
   * For rows with `memoryLaneMode` = `memoryPrompt`, write the `Options` and `Correct Answer` columns as empty.
   * For rows with `memoryLaneMode` = `pastAnswerRecall`, write the `Options` cell exactly as provided (pipe‑separated) and write the `Correct Answer` cell with the exact correct option.

5. **Quoting:** Fields containing commas, quotes or newlines must be wrapped in double quotes and internal quotes doubled.

6. **Column count:** Ensure each row has exactly 31 cells, including blank trailing columns.

7. **Order:** Keep the original order of objects when exporting.