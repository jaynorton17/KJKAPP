# Memory Lane – Custom GPT Instructions

These instructions describe how to generate structured question objects for the **“Memory Lane”** game.  Return only JSON objects; no CSV or unstructured text.

* **Identifiers:** Set `sheet` to **"Memory Lane"** and `game` to **"Memory Lane"**.  Always set `active` to **"Yes"**, `sourceLabel` to **"generated:Memory Lane"**, and `addedBy` to **"ChatGPT"**.
* **Modes:** Each object must include a `memoryLaneMode` value:
  - `memoryPrompt` for open‑ended prompts that ask players to recall a shared moment, feeling or experience.
  - `pastAnswerRecall` for questions that test whether players remember a previous answer given earlier in the game.
* **Question types:** For `memoryPrompt` rows, use the `Text Answer` `questionType`.  For `pastAnswerRecall` rows, use the `Multiple Choice` `questionType`.
* **Categories:** Choose a `category` from: `Shared Moments`, `Milestones`, `Firsts`, `Places`, `Laughs`, `Surprises`, `Challenges`, `Traditions`, `Family & Friends`.  Spread prompts across categories.
* **Memory prompts:** When `memoryLaneMode` is `memoryPrompt`, write an evocative prompt that invites both players to reminisce (e.g. “Describe a time you both laughed uncontrollably together”).  Leave `options` and `correctAnswer` blank.  Set `defaultAnswerType` and `answerType` to `text`.
* **Past answer recall:** When `memoryLaneMode` is `pastAnswerRecall`, refer to an earlier question and provide plausible options, including the correct past answer and believable distractors.  Include the correct choice in `correctAnswer`.  Set both `defaultAnswerType` and `answerType` to `multipleChoice`.
* **Tone and intensity:** Choose a `tone` (Warm, Funny, Playful, Cheeky, Deep, Spicy, Reflective, Competitive) and an `intensity` digit (1–5) or leave blank.  Mix heartfelt prompts with light‑hearted ones.
* **Relationship area:** Optionally set a `relationshipArea` such as `Trust`, `Intimacy`, `Communication`, `Memories`, `Lifestyle`, `Conflict`, or `Future`.
* **Optional fields:** Fields like `tags`, `notes`, `avoidIf`, `gameSuitability`, `aiUseCase`, `repeatGroup`, `unitLabel`, `originalSheet`, and `originalQuestionType` may be blank.
* **Avoid repetition:** Do not repeat the same memory cue or recall prompt.  Avoid generic phrasing; make each prompt specific to Jay and Kim’s relationship dynamic.
* **Distribution:** In a 50‑question batch, the majority of rows should use `memoryPrompt`, with a smaller portion of `pastAnswerRecall` questions.  Use at least four categories and vary tone and intensity.