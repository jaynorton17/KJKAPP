# Put Your Points Where Your Mouth Is – Validator Rules

This document defines the deterministic rules that a validator must enforce for the “Put Your Points Where Your Mouth Is” game.  All generated question objects must pass these checks before being exported to CSV.

## 1. Fixed values

* `sheet` must be exactly **“Put Your Money Where Your Mouth Is”**.
* `game` must be exactly **“Put Your Points Where Your Mouth Is”**.
* `active` must be **“Yes”**.
* `sourceLabel` must be **“generated:Put Your Points”**.
* `addedBy` must be **“ChatGPT”**.
* The scoring fields must be constant: `scoringDivisor` = **1**, `roundingMode` = **“nearest”**, `roundPenaltyValue` = **5**, `fixedPenalty` = **5**, `scoringMode` = **“direct_penalty_entry”**, `scoringOutcomeType` = **“exact_match_else_fixed_penalty”**.

## 2. Required fields

Ensure that the following fields are present and non‑empty:

* `question` – natural‑language prompt.
* `category` – one of the allowed categories.
* `questionType` – one of the allowed question types.
* `defaultAnswerType` and `answerType` – must match the mappings defined below.

Optional fields (`options`, `correctAnswer`, `intensity`, `tone`, `relationshipArea`, `tags`, `notes`, `avoidIf`, `gameSuitability`, `aiUseCase`, `repeatGroup`, `unitLabel`, `memoryLaneMode`, `originalSheet`, `originalQuestionType`) may be empty.

## 3. Enumerations

* `category` must be in {Affection, Attraction, Secrets, Habits, Memory, Conflict, Future, Money, Playful, Spicy, Embarrassing, Comfort}.
* `questionType` must be in {Favourite, Fill in the Blank, Multiple Choice, Numeric, Open Answer, Pet Peeve, Preference, Ranked / Top 3, Ranking, Rating, Text Answer, True or False, Who is more likely to, Would you rather, Sort Into Order}.
* `tone`, if provided, must be one of {Warm, Funny, Playful, Cheeky, Deep, Spicy, Reflective, Competitive}.
* `intensity`, if provided, must be a digit 1–5.
* `relationshipArea`, if provided, must be one of {Trust, Intimacy, Communication, Memories, Lifestyle, Conflict, Future}.
* `defaultAnswerType` and `answerType` must be one of {text, multipleChoice, number, ranked}.

## 4. Answer type mapping

Check that `defaultAnswerType` and `answerType` correspond to `questionType`:

| Question type                          | Default/Answer type |
|---------------------------------------|---------------------|
| Favourite, Fill in the Blank, Open Answer, Pet Peeve, Text Answer | text |
| Multiple Choice, Preference, Would you rather, True or False, Who is more likely to | multipleChoice |
| Numeric, Rating                       | number             |
| Ranked / Top 3, Ranking, Sort Into Order | ranked             |

If the question type does not match the answer type mapping, the object is invalid.

## 5. Options

* For **choice‑based** types (Multiple Choice, Preference, Would You Rather, Ranking, Sort Into Order) the `options` field must contain a pipe‑separated list of at least two unique options.  Each option must be relevant to the question and should not include the player names (Jay, Kim, Both, Neither).
* For **True or False** and **Who is more likely to** questions, `options` and `correctAnswer` must be empty; the app supplies these choices.  The `correctAnswer` field should remain blank because the game is not a quiz.
* The validator should check that no two questions share the same set of options (case‑insensitive) within a batch.

## 6. Correct answer

* `correctAnswer` must be blank for every question in this game.  Any non‑blank value is invalid.

## 7. Intensity and tone

* If `intensity` is provided, it must be a single digit 1–5.  Do not allow words such as “gentle” or “spicy” in this field.
* `tone` must be one of the allowed mood labels; do not allow numeric values here.

## 8. Uniqueness

* The validator must detect duplicate or near‑duplicate questions in the batch.  Compare lower‑cased, punctuation‑stripped versions of the `question` strings.  If two questions only differ by trivial words or by swapping small nouns, they should be considered duplicates.
* The validator should also detect reused option pools.  If two questions use the same options (even in a different order), flag the second as a duplicate.
* Use the `repeatGroup` field to group near‑duplicates, but do not automatically assign this value in generation.

## 9. Distribution

For any batch of 50 questions:

* Include at least **five** different question types.
* Include at least **four** different categories.
* Use at least **two** tone values and **two** intensity levels.

The validator should report a failure if these distribution rules are not satisfied.

## 10. Optional fields

Fields not listed above are optional.  If present, they must conform to their type definitions in the schema.  Fields such as `notes`, `avoidIf`, `gameSuitability`, `aiUseCase`, `repeatGroup`, `unitLabel`, `memoryLaneMode`, `originalSheet`, and `originalQuestionType` may remain empty strings.