# This or That – Validator Rules

Validate each generated object for the **“This or That”** game using this checklist.

## 1. Fixed values

* `sheet` must be exactly **“This or That”**.
* `game` must be exactly **“This or That”**.
* `active` must be **“Yes”**.
* `sourceLabel` must be **“generated:This or That”**.
* `addedBy` must be **“ChatGPT”**.

## 2. Required fields

The following must be non‑empty:

* `question` – the preference prompt.
* `category` – one of the allowed categories.
* `questionType` – must be `Preference`.
* `options` – must contain at least two unique options separated by `|`.
* `defaultAnswerType` and `answerType` – must both equal `multipleChoice`.

## 3. Allowed values

* `category` ∈ {Date Night, Comfort, Flirting, Food & Drink, Travel, Home Life, Conflict Style, Spicy, Future}.
* `questionType` must be `Preference` (no other types are valid).
* `tone`, if provided, ∈ {Warm, Funny, Playful, Cheeky, Deep, Spicy, Reflective, Competitive}.
* `intensity`, if provided, must be a digit 1–5.
* `relationshipArea`, if provided, ∈ {Trust, Intimacy, Communication, Memories, Lifestyle, Conflict, Future}.

## 4. Options rules

* `options` must contain at least two unique choices separated by `|`.  Options should be concise phrases and directly relevant to the question.
* Do not include player names (Jay, Kim, Both, Neither) or generic placeholders.
* The validator must detect and reject any repeated option sets across questions.

## 5. Correct answer

`correctAnswer` must be empty.  Any non‑blank value is invalid.

## 6. Answer types

`defaultAnswerType` and `answerType` must both be `multipleChoice`.  No other values are allowed.

## 7. Uniqueness

* Reject questions that are duplicates or near duplicates (case‑insensitive, ignoring punctuation) of others in the batch.
* Reject questions that reuse the same set of options (after normalising case and removing whitespace).

## 8. Distribution

In a batch of 50 questions:

* Use at least **four** distinct categories.
* Use at least **two** different tone values and **two** different intensity levels.

## 9. Optional fields

Fields not listed above may be empty.  Scoring columns must remain blank.