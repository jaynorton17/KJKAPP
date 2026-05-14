# Normal Game – Validator Rules

The following checklist defines the deterministic validation rules for objects generated for the **“Normal Game”**.  Any question object failing these checks should be rejected prior to CSV export.

## 1. Fixed values

* `sheet` must equal **“Questions”**.
* `game` must equal **“Normal Game”**.
* `active` must be **“Yes”**.
* `sourceLabel` must equal **“generated:Normal Game”**.
* `addedBy` must equal **“ChatGPT”**.

## 2. Required fields

The validator must confirm that the following fields are present and non‑empty:

* `question` – the prompt shown to players.
* `category` – must be one of the allowed categories.
* `questionType` – must be one of the allowed types.
* `defaultAnswerType` and `answerType` – must match the defined mapping.

Other fields may be empty strings.

## 3. Allowed values

* `category` ∈ {Affection, Communication, Everyday Life, Memories, Future, Money, Habits, Family & Friends, Playful, Spicy}.
* `questionType` ∈ {Favourite, Fill in the Blank, Multiple Choice, Numeric, Open Answer, Pet Peeve, Preference, Ranked / Top 3, Ranking, Rating, Text Answer, True or False, Who is more likely to, Would you rather, Sort Into Order}.
* `tone`, if provided, ∈ {Warm, Funny, Playful, Cheeky, Deep, Spicy, Reflective, Competitive}.
* `intensity`, if provided, must be a digit 1–5.
* `relationshipArea`, if provided, ∈ {Trust, Intimacy, Communication, Memories, Lifestyle, Conflict, Future}.
* `defaultAnswerType`, `answerType` ∈ {text, multipleChoice, number, ranked}.

## 4. Answer type mapping

Ensure consistency between `questionType` and answer types:

| Question type                          | Answer type    |
|---------------------------------------|---------------|
| Favourite, Fill in the Blank, Open Answer, Pet Peeve, Text Answer | text          |
| Multiple Choice, Preference, Would you rather, True or False, Who is more likely to | multipleChoice |
| Numeric, Rating                       | number        |
| Ranked / Top 3, Ranking, Sort Into Order | ranked        |

If the `defaultAnswerType` or `answerType` does not match the table, reject the object.

## 5. Options rules

* For **choice‑based** types (Multiple Choice, Preference, Would You Rather, Ranking, Sort Into Order) the `options` field must contain at least two unique options separated by the pipe character (`|`).  Do not allow player names (Jay, Kim, Both, Neither) unless the type is `Who is more likely to`.
* For **True or False** and **Who is more likely to**, `options` and `correctAnswer` must be blank; the app supplies these choices.
* The validator must detect and reject any repeated option pools (case‑insensitive, ignoring order) across questions within a batch.

## 6. Correct answer

`correctAnswer` must always be blank for this game.  Any non‑blank value invalidates the object.

## 7. Intensity and tone

If `intensity` is provided, it must be a single digit 1–5.  `tone`, if provided, must be one of the allowed mood labels.  Do not allow numeric values in the tone field.

## 8. Uniqueness

* Reject any question that duplicates or nearly duplicates another question in the batch.  Compare lower‑cased versions stripped of punctuation and trivial modifiers.
* Reject any two questions that reuse the same options list (after normalising case and removing whitespace).  This prevents repeated choice sets.
* The `repeatGroup` field may be used for duplicate tracking but should not be auto‑populated by the generator.

## 9. Distribution

In a batch of 50 questions, enforce that at least:

* **Five** distinct question types appear;
* **Four** distinct categories appear;
* **Two** tones and **two** intensity levels appear.

Report a failure if these distribution requirements are not satisfied.

## 10. Optional fields and scoring

Fields not mentioned above may be blank.  Because the Normal Game does not use scoring, leave `scoringDivisor`, `roundingMode`, `roundPenaltyValue`, `fixedPenalty`, `scoringMode` and `scoringOutcomeType` empty.  If present, these fields must not contain any values.