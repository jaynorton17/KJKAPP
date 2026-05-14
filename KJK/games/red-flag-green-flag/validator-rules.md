# Red Flag Green Flag – Validator Rules

Validate each generated object for the **“Red Flag Green Flag”** game using this checklist.

## 1. Fixed values

* `sheet` must equal **“Red Flag Green Flag”**.
* `game` must equal **“Red Flag Green Flag”**.
* `active` must be **“Yes”**.
* `sourceLabel` must be **“generated:Red Flag Green Flag”**.
* `addedBy` must be **“ChatGPT”**.

## 2. Required fields

* `question` – a behaviour or scenario for evaluation.
* `category` – one of the allowed categories.
* `questionType` – must be `Multiple Choice`.
* `defaultAnswerType` and `answerType` – must both equal `multipleChoice`.

## 3. Allowed values

* `category` ∈ {Trust, Communication, Boundaries, Lifestyle, Money, Habits, Romance, Family & Friends, Career, Spicy}.
* `tone`, if provided, ∈ {Warm, Funny, Playful, Cheeky, Deep, Spicy, Reflective, Competitive}.
* `intensity`, if provided, must be a digit 1–5.
* `relationshipArea`, if provided, ∈ {Trust, Intimacy, Communication, Memories, Lifestyle, Conflict, Future}.

## 4. Options and correct answer

* `options` must be empty.  The game supplies Green Flag, Red Flag and Depends.
* `correctAnswer` must be empty.  There is no predetermined answer.

## 5. Answer types

* `defaultAnswerType` and `answerType` must both be `multipleChoice`.  No other values are allowed.

## 6. Uniqueness

* Reject scenarios that are duplicates or near duplicates of others in the batch (case‑insensitive, ignoring punctuation).
* Avoid obviously one‑sided situations where all players would choose the same answer.  Aim for debatable behaviours.

## 7. Distribution

In a 50‑question batch:

* Use at least **four** categories.
* Use at least **two** tone values and **two** intensity levels.

## 8. Optional fields

Fields not listed above may be blank.  Scoring fields must remain blank.  Use `tags` sparingly for keywords.