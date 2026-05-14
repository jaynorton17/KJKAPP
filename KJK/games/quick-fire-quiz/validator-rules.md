# Quick Fire Quiz – Validator Rules

This checklist enforces the requirements for quiz question objects before they are exported.

## 1. Fixed values

* `sheet` must equal **“Quiz”**.
* `game` must equal **“Quick Fire Quiz”**.
* `active` must be **“Yes”**.
* `sourceLabel` must equal **“generated:Quick Fire Quiz”**.
* `addedBy` must equal **“ChatGPT”**.

## 2. Required fields

Ensure that `question`, `category`, `questionType`, `defaultAnswerType`, `answerType`, and `correctAnswer` are present and non‑empty.  Unlike other games, `correctAnswer` is mandatory in the quiz.

## 3. Allowed values

* `category` ∈ {Personal Trivia, Relationship History, Dates & Places, Preferences, Memories, Funny Facts, Cheeky Facts, Household}.
* `questionType` ∈ {Multiple Choice, True or False, Text Answer}.
* `tone`, if provided, ∈ {Warm, Funny, Playful, Cheeky, Deep, Spicy, Reflective, Competitive}.
* `intensity`, if provided, must be a digit 1–5.
* `relationshipArea`, if provided, ∈ {Trust, Intimacy, Communication, Memories, Lifestyle, Conflict, Future}.
* `defaultAnswerType` and `answerType` ∈ {text, multipleChoice}.

## 4. Answer type mapping

Enforce the following mapping:

| Question type    | Default/Answer type |
|------------------|---------------------|
| Multiple Choice  | multipleChoice      |
| True or False    | multipleChoice      |
| Text Answer      | text                |

If the mapping is incorrect, the object is invalid.

## 5. Options and correct answer

* For **Multiple Choice**:
  * `options` must contain at least two unique choices separated by `|`.
  * One of the choices must match `correctAnswer` exactly (case sensitive).  Reject any question where the correct answer is not among the options.
* For **True or False**:
  * `options` must be empty; the app provides “True” and “False” choices.
  * `correctAnswer` must be either `True` or `False` (capitalised).
  * The `question` should be phrased as a statement, not a question.
* For **Text Answer**:
  * `options` must be empty.
  * `correctAnswer` must be a concise factual answer (non‑empty string).

The validator must reject any object where options and correct answer rules are violated.

## 6. Uniqueness

* Quiz questions must be unique.  Reject any two questions that ask the same fact or use identical wording after case normalisation and punctuation stripping.
* Reject any two multiple choice questions that reuse the same option set.

## 7. Distribution

In a 50‑question batch, encourage a mix of multiple choice, true or false and text answer formats, and coverage across categories.  While not enforced programmatically, report any batch that is overly skewed towards a single type or category.

## 8. Optional fields

Fields not mentioned above may be empty.  Scoring columns must remain blank.  `memoryLaneMode` is unused in this game.