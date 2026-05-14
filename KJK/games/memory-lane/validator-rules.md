# Memory Lane – Validator Rules

Validate each generated object for the **“Memory Lane”** game with this checklist.

## 1. Fixed values

* `sheet` must equal **“Memory Lane”**.
* `game` must equal **“Memory Lane”**.
* `active` must be **“Yes”**.
* `sourceLabel` must be **“generated:Memory Lane”**.
* `addedBy` must be **“ChatGPT”**.

## 2. Required fields

* `question` – the prompt itself.
* `category` – one of the allowed categories.
* `questionType` – must be either `Text Answer` or `Multiple Choice` as appropriate.
* `memoryLaneMode` – must be present and either `memoryPrompt` or `pastAnswerRecall`.
* `defaultAnswerType` and `answerType` – must not be blank and must match the mode rules below.

## 3. Modes and question types

* If `memoryLaneMode` = `memoryPrompt`:
  - `questionType` must be `Text Answer`.
  - `options` and `correctAnswer` must be empty.
  - `defaultAnswerType` and `answerType` must both be `text`.
* If `memoryLaneMode` = `pastAnswerRecall`:
  - `questionType` must be `Multiple Choice`.
  - `options` must contain at least two unique pipe‑separated choices.
  - `correctAnswer` must be one of the options and non‑empty.
  - `defaultAnswerType` and `answerType` must both be `multipleChoice`.

## 4. Allowed values

* `category` ∈ {Shared Moments, Milestones, Firsts, Places, Laughs, Surprises, Challenges, Traditions, Family & Friends}.
* `tone`, if provided, ∈ {Warm, Funny, Playful, Cheeky, Deep, Spicy, Reflective, Competitive}.
* `intensity`, if provided, must be a digit 1–5.
* `relationshipArea`, if provided, ∈ {Trust, Intimacy, Communication, Memories, Lifestyle, Conflict, Future}.
* `defaultAnswerType` ∈ {text, multipleChoice}.
* `answerType` ∈ {text, multipleChoice}.

## 5. Options and correct answer

* For `pastAnswerRecall` rows, ensure `options` contains the correct answer and at least one plausible distractor.  Options must be unique and relevant.
* For `memoryPrompt` rows, both `options` and `correctAnswer` must be blank.

## 6. Uniqueness

* Reject prompts that are duplicates or near duplicates (case‑insensitive, ignoring punctuation).
* Reject questions that reuse the same option set.

## 7. Distribution

In a 50‑question batch:

* The majority of rows should use `memoryPrompt`.
* Include at least a few `pastAnswerRecall` prompts.
* Use at least four categories.
* Use at least two different tone values and two different intensity levels.

## 8. Optional fields

Fields not listed above may be blank.  All scoring fields must remain blank.