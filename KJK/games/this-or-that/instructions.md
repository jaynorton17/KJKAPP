# This or That – Custom GPT Instructions

These instructions tell the generator how to create structured question objects for the **“This or That”** game.  Only JSON objects should be produced, never CSV or free‑form text.

* **Identifiers:** Set `sheet` to **"This or That"**, `game` to **"This or That"**, `active` to **"Yes"**, `sourceLabel` to **"generated:This or That"**, and `addedBy` to **"ChatGPT"**.
* **Question:** Pose a clear, engaging “this or that” prompt that asks the players to choose between two (or occasionally more) options.  The phrasing should indicate choice without listing the options yet (e.g. “Cosy night in or adventurous night out?”).  Do not include numbering or filler words.
* **Allowed type:** Use only the `Preference` question type for this game.
* **Categories:** Select from: `Date Night`, `Comfort`, `Flirting`, `Food & Drink`, `Travel`, `Home Life`, `Conflict Style`, `Spicy`, `Future`.  Cover multiple categories in a batch.
* **Tone and intensity:** Choose a `tone` from `Warm`, `Funny`, `Playful`, `Cheeky`, `Deep`, `Spicy`, `Reflective`, `Competitive`.  Use an `intensity` digit (1–5) or leave it blank.  Vary tones and intensities across a batch.
* **Relationship area:** Optionally set `relationshipArea` (e.g. `Lifestyle`, `Intimacy`, `Future`).  This field may be blank.
* **Options:** Provide a pipe‑separated string of two or more unique options directly relevant to the question (e.g. `Cosy night in | Adventurous night out`).  Do not reuse option sets across questions.  Never include player names or placeholders like “Option A”.
* **Correct answer:** Leave `correctAnswer` blank.  This game involves personal preferences, not factual answers.
* **Answer type:** Both `defaultAnswerType` and `answerType` are always `multipleChoice`.
* **Scoring:** Leave all scoring fields blank; the game does not use penalties or scores.
* **Optional fields:** `tags`, `notes`, `avoidIf`, `gameSuitability`, `aiUseCase`, `repeatGroup`, `unitLabel`, `memoryLaneMode`, `originalSheet`, `originalQuestionType` may be empty.  Use `tags` sparingly to add keywords.
* **Avoid repetition:** Each question must ask about a different choice.  Do not repeat the same basic comparison with slightly different wording.  Do not reuse option pools.
* **Distribution:** In a 50‑question batch, aim to cover at least four categories and vary tone and intensity.  Although only one question type exists, vary the phrasing and subject matter.