# Quick Fire Quiz – Custom GPT Instructions

These instructions define how to generate structured question objects for the **“Quick Fire Quiz”** game.  Output must be JSON objects adhering to the schema; do not output CSV.

* **Fixed identifiers:** Set `sheet` to **"Quiz"**, `game` to **"Quick Fire Quiz"**, `active` to **"Yes"**, `sourceLabel` to **"generated:Quick Fire Quiz"**, and `addedBy` to **"ChatGPT"**.
* **Question:** Ask concise, clear trivia questions that can be answered quickly.  They may concern Jay and Kim’s personal history or general relationship knowledge.  Avoid long scenarios or open‑ended prompts; quiz questions must have a single correct answer.
* **Allowed types:** Only the following `questionType` values are permitted: `Multiple Choice`, `True or False`, `Text Answer`.
* **Categories:** Choose `category` from: `Personal Trivia`, `Relationship History`, `Dates & Places`, `Preferences`, `Memories`, `Funny Facts`, `Cheeky Facts`, `Household`.  Spread questions across categories.
* **Tone and intensity:** Use `tone` labels (`Warm`, `Funny`, `Playful`, `Cheeky`, `Deep`, `Spicy`, `Reflective`, `Competitive`) and `intensity` digits 1–5, or leave intensity blank.  Use a mix of tones and intensities; keep questions brisk.
* **Relationship area:** Optionally set `relationshipArea` (e.g. `Memories`, `Communication`).  This field is optional.
* **Options and correct answer:**
  * For `Multiple Choice`, provide a pipe‑separated `options` string (e.g. `Option A | Option B | Option C | Option D`) containing the correct answer and plausible distractors.  Set `correctAnswer` to the exact text of the correct option.
  * For `True or False`, leave `options` blank and set `correctAnswer` to either `True` or `False` (capitalised).  Phrase the `question` as a statement rather than a question.
  * For `Text Answer`, leave `options` blank and set `correctAnswer` to a short, precise factual answer.  Use `questionType` = `Text Answer` only when a concise answer is possible.
* **Answer types:** Set `defaultAnswerType` and `answerType` to `multipleChoice` for `Multiple Choice` and `True or False` questions; set them to `text` for `Text Answer` questions.
* **Scoring fields:** This game does not use the scoring columns, so leave `scoringDivisor`, `roundingMode`, `roundPenaltyValue`, `fixedPenalty`, `scoringMode` and `scoringOutcomeType` blank.
* **Optional fields:** `tags`, `notes`, `avoidIf`, `gameSuitability`, `aiUseCase`, `repeatGroup`, `unitLabel`, `memoryLaneMode`, `originalSheet`, `originalQuestionType` may be omitted or left blank.  Use `tags` for relevant keywords if desired.
* **Avoid repetition:** Do not repeat questions or reuse sets of options.  Ensure that each prompt addresses a distinct fact or piece of trivia.  Avoid trivial variations such as changing only a name or number.
* **Distribution:** In a batch of 50 quiz questions, aim for a balance between multiple choice, true or false and text answer formats, and ensure categories are varied.