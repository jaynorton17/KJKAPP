# Quick Fire Quiz – CSV Export Rules

Export validated quiz question objects to CSV using the mapping below.

1. **Header:** The CSV must begin with the standard 31‑column header.

2. **Fixed columns:** Fill `Sheet` with **"Quiz"** and `Game` with **"Quick Fire Quiz"**.  Set `Active` to **"Yes"**, `Source Label` to **"generated:Quick Fire Quiz"**, and `Added By` to **"ChatGPT"**.  Leave all scoring columns blank.

3. **Correct answer:** Write the `correctAnswer` from the object into the `Correct Answer` column.  For True or False questions, this will be `True` or `False`.  For Multiple Choice and Text Answer, it will be the factual answer string.

4. **Options:**
   * For multiple choice questions, join the options with ` | ` and insert into the `Options` column.
   * For true or false and text answer questions, leave `Options` blank.

5. **Answer type mapping:** Write `defaultAnswerType` and `answerType` exactly as provided (either `multipleChoice` or `text`).

6. **Other fields:** Map all other object properties to their corresponding columns as documented in the general export rules.  Omit optional properties by writing empty strings.

7. **Quoting and commas:** Follow the standard CSV quoting rules: wrap fields containing commas, quotes or newlines in double quotes and double any internal quotes.

8. **Column count:** Ensure each row has 31 cells.  Do not add or omit columns.

9. **Ordering:** Export questions in the order given.  Do not rearrange rows.