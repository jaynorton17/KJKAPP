# How Sure Are You? – Validator Rules

This checklist defines the deterministic rules used to validate generated question objects for the **“How Sure Are You?”** game before exporting them to CSV.

## 1. Fixed values

* `sheet` must be exactly **“How Sure Are You”**.
* `game` must be exactly **“How Sure Are You?”**.
* `active` must be **“Yes”**.
* `sourceLabel` must be **“generated:How Sure Are You”**.
* `addedBy` must be **“ChatGPT”**.
* Scoring fields must be the following constants: `scoringDivisor` = 1, `roundingMode` = `nearest`, `roundPenaltyValue` = 5, `fixedPenalty` = 5, `scoringMode` = `direct_penalty_entry`, `scoringOutcomeType` = `exact_match_else_fixed_penalty`.

## 2. Required fields

The following properties are mandatory and must not be empty:

* `question` – the player‑facing prompt.
* `category` – one of the allowed categories.
* `questionType` – one of the allowed question types.
* `defaultAnswerType` and `answerType` – must match the mappings below.

All other properties may be empty strings.

## 3. Enumerations

* `category` ∈ {Affection, Attraction, Turn Ons, Secrets, Habits, Hobbies, Memory, Conflict, Future, Money, Playful, Spicy, Boundaries, Comfort}.
* `questionType` ∈ {Favourite, Fill in the Blank, Multiple Choice, Numeric, Open Answer, Pet Peeve, Preference, Ranked / Top 3, Ranking, Rating, Text Answer, True or False, Who is more likely to, Would you rather, Sort Into Order}.
* `tone`, if provided, ∈ {Warm, Funny, Playful, Cheeky, Deep, Spicy, Reflective, Competitive}.
* `intensity`, if provided, must be a digit from 1 to 5.
* `relationshipArea`, if provided, ∈ {Trust, Intimacy, Communication, Memories, Lifestyle, Conflict, Future}.
* `defaultAnswerType`, `answerType` ∈ {text, multipleChoice, number, ranked}.

## 4. Answer type mapping

Ensure the following mapping between `questionType` and `defaultAnswerType`/`answerType`:

| Question type                          | Answer type    |
|---------------------------------------|---------------|
| Favourite, Fill in the Blank, Open Answer, Pet Peeve, Text Answer | text          |
| Multiple Choice, Preference, Would you rather, True or False, Who is more likely to | multipleChoice |
| Numeric, Rating                       | number        |
| Ranked / Top 3, Ranking, Sort Into Order | ranked        |

If the `answerType` does not correspond to the `questionType`, mark the object invalid.

## 5. Options

* For **choice‑based** types (Multiple Choice, Preference, Would You Rather, Ranking, Sort Into Order) the `options` field must contain at least two unique options separated by `|`.  Options must be tailored to the question and not repeated across questions.
* For **True or False** and **Who is more likely to** questions, both `options` and `correctAnswer` must be empty; the app supplies the answer buttons.
* The validator should detect any reuse of an option set (case‑insensitive) across questions and reject duplicates.

## 6. Correct answer

`correctAnswer` must always be blank.  This game compares personal answers; there is no factual answer.

## 7. Intensity and tone

* If `intensity` is present, it must be a single character 1–5.
* `tone`, if present, must be one of the allowed mood labels.  Do not allow numbers in this field.

## 8. Uniqueness

* Reject any question that duplicates or nearly duplicates another in the batch.  Use case‑insensitive comparison, ignoring punctuation and trivial word changes.
* Reject any two questions that share the same option set (after normalising case and removing spaces), except for fixed‑choice types where options are always blank.
* The `repeatGroup` field may be used to mark near‑duplicates but should not be auto‑generated.

## 9. Distribution

For a 50‑question batch, enforce that:

* At least **five** distinct question types appear.
* At least **four** distinct categories appear.
* At least **two** different tones and **two** different intensity levels appear.

If these conditions are not met, flag the batch for revision.

## 10. Optional fields

Optional fields (`tags`, `notes`, `avoidIf`, `gameSuitability`, `aiUseCase`, `repeatGroup`, `unitLabel`, `memoryLaneMode`, `originalSheet`, `originalQuestionType`) may be left blank.  If present, they must conform to the schema.