# True or False – Validator Rules

Use this checklist to validate each generated object for the **“True or False”** game.

## 1. Fixed values

* `sheet` must equal **“True or False”**.
* `game` must equal **“True or False”**.
* `active` must be **“Yes”**.
* `sourceLabel` must be **“generated:True or False”**.
* `addedBy` must be **“ChatGPT”**.

## 2. Required fields

The following fields must be present and non‑empty (unless explicitly noted as blank):

* `question` – a declarative statement.
* `category` – one of the allowed categories.
* `questionType` – must be `True or False`.
* `defaultAnswerType` – must be `multipleChoice`.
* `answerType` – must be `multipleChoice`.

## 3. Allowed values

* `category` ∈ {Trust, Communication, Jealousy, Habits, Romance, Conflict, Confidence, Future, Spicy, Playful}.
* `questionType` must be `True or False` (no other types are valid).
* `tone`, if provided, ∈ {Warm, Funny, Playful, Cheeky, Deep, Spicy, Reflective, Competitive}.
* `intensity`, if provided, must be a digit 1–5.
* `relationshipArea`, if provided, ∈ {Trust, Intimacy, Communication, Memories, Lifestyle, Conflict, Future}.

## 4. Options and correct answer

* `options` must be empty.  Any non‑blank value is invalid.
* `correctAnswer` must be empty.  There is no predetermined truth for the players; they decide.

## 5. Answer types

* `defaultAnswerType` and `answerType` must both be `multipleChoice`.  No other values are allowed.

## 6. Uniqueness

* Reject statements that are duplicates or near duplicates of others in the batch (case‑insensitive and ignoring punctuation).
* Avoid trivial facts that are obviously true or false and leave no room for debate.

## 7. Distribution

In a 50‑question batch:

* Use at least **four** different categories.
* Use at least **two** different tone values and **two** different intensity levels.

## 8. Optional fields

Fields not listed above may be blank.  Scoring fields must remain blank.  Use `tags` sparingly for keywords if needed.