# Compatibility Meter – Validator Rules

Validate each generated object for the **“Compatibility Meter”** game with this checklist.

## 1. Fixed values

* `sheet` must equal **“Compatibility”**.
* `game` must equal **“Compatibility Meter”**.
* `active` must be **“Yes”**.
* `sourceLabel` must be **“generated:Compatibility Meter”**.
* `addedBy` must be **“ChatGPT”**.

## 2. Required fields

* `question` – the prompt posed to both players.
* `category` – one of the allowed categories.
* `questionType` – must be one of the allowed question types.
* `defaultAnswerType` and `answerType` – must not be blank and must correspond to the `questionType`.

## 3. Allowed values

* `category` ∈ {Practical, Romantic, Emotional, Lifestyle, Future, Conflict, Money, Intimacy}.
* `questionType` ∈ {Favourite, Fill in the Blank, Multiple Choice, Numeric, Open Answer, Pet Peeve, Preference, Ranked / Top 3, Ranking, Rating, Text Answer, True or False, Who is more likely to, Would you rather, Sort Into Order}.
* `tone`, if provided, ∈ {Warm, Funny, Playful, Cheeky, Deep, Spicy, Reflective, Competitive}.
* `intensity`, if provided, must be a digit 1–5.
* `relationshipArea`, if provided, ∈ {Trust, Intimacy, Communication, Memories, Lifestyle, Conflict, Future}.
* `defaultAnswerType` and `answerType` must be consistent with `questionType`:
  - `text` for `Favourite`, `Fill in the Blank`, `Open Answer`, `Pet Peeve`, `Ranked / Top 3`, `Text Answer`.
  - `multipleChoice` for `Multiple Choice`, `Preference`, `True or False`, `Who is more likely to`, `Would you rather`.
  - `number` for `Numeric`, `Rating`.
  - `ranked` for `Ranking`, `Sort Into Order`.

## 4. Options and correct answer

* `correctAnswer` must be empty for this game.
* For choice‑based types (`Multiple Choice`, `Preference`, `Would you rather`, `Ranking`, `Sort Into Order`):
  - `options` must contain at least two unique pipe‑separated choices.
  - Do not reuse the same set of options across multiple rows.
* For ranking and sort‑into‑order questions, ensure the number of items in `options` matches the question text.
* For free‑text, numeric, rating and true/false types, `options` must be empty.
* Do not include player names or placeholder labels in options.

## 5. Uniqueness

* Reject duplicate or near‑duplicate questions (case‑insensitive, ignoring punctuation).
* Reject rows that reuse the same option set (normalised for case and whitespace).

## 6. Distribution

In a 50‑question batch:

* Use at least **four** different categories.
* Use at least **five** different question types.
* Use at least **two** different tone values and **two** different intensity levels.

## 7. Optional fields

Fields not listed above may be blank.  Scoring fields must remain blank.  Use `unitLabel` when a numeric question has units (e.g. minutes, dollars, days).  Use `tags` sparingly to classify content.