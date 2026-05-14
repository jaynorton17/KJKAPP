# Most Likely To – Validator Rules

Validate each generated object for the **“Most Likely To”** game using this checklist.

## 1. Fixed values

* `sheet` must equal **“Most Like To”**.
* `game` must equal **“Most Likely To”**.
* `active` must be **“Yes”**.
* `sourceLabel` must be **“generated:Most Likely To”**.
* `addedBy` must be **“ChatGPT”**.

## 2. Required fields

* `question` – a “who is most likely to…” prompt.
* `category` – one of the allowed categories.
* `questionType` – must be `Multiple Choice`.
* `defaultAnswerType` and `answerType` – must both equal `multipleChoice`.

## 3. Allowed values

* `category` ∈ {Funny, Household, Romance, Chaos, Social Life, Money, Jealousy, Confidence, Spicy, Future}.
* `tone`, if provided, ∈ {Warm, Funny, Playful, Cheeky, Deep, Spicy, Reflective, Competitive}.
* `intensity`, if provided, must be a digit 1–5.
* `relationshipArea`, if provided, ∈ {Trust, Intimacy, Communication, Memories, Lifestyle, Conflict, Future}.

## 4. Options and correct answer

* `options` must be empty.  The game supplies the buttons Jay, Kim, Both and Neither.
* `correctAnswer` must be empty.  There is no factual answer.

## 5. Answer types

* `defaultAnswerType` and `answerType` must both be `multipleChoice`.  No other values are valid.

## 6. Uniqueness

* Reject prompts that are duplicates or near duplicates of each other (case‑insensitive, ignoring punctuation).
* Reject rows that reuse the same scenario with minor wording changes.

## 7. Distribution

In a 50‑question batch:

* Use at least **four** different categories.
* Use at least **two** tone values and **two** intensity levels.

## 8. Optional fields

Fields not listed above may be blank.  Scoring fields must remain blank.  Use `tags` sparingly for keywords if desired.