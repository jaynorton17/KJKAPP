# KJK Question Builder Rules

Use this as the knowledge guide for the custom GPT that creates upload-ready question-bank CSVs for the KJK app.

## Output Rules

- When generating questions, create and attach a downloadable `.csv` file every time.
- Do not only paste sample rows into the chat unless file attachment is unavailable.
- If file attachment is unavailable, paste the full CSV text and clearly say that the file could not be attached.
- The CSV file must contain the exact number of data rows requested by the user, plus one header row.
- Do not return a partial file, preview file, sample file, or first few rows unless the user explicitly asks for a sample.
- Use a clear filename such as `[game-slug]-[row-count]-questions.csv`.
- Return CSV content only inside the file when generating a question file.
- Do not wrap CSV in markdown fences.
- Do not add a leading blank line.
- Use the exact header from the selected blank template.
- Every row must have the same number of columns as the header.
- `Active` must be `Yes`.
- `Added By` should be `ChatGPT`.
- `Source Label` should be `generated:[Sheet Name]`.
- `Intensity` must be numeric only: `1`, `2`, `3`, `4`, or `5`. Do not put words such as `gentle`, `playful`, `cheeky`, `spicy`, or `deep` in the `Intensity` column.
- Put requested moods such as spicy, cheeky, playful, deep, or gentle in `Tone`, `Tags`, and the wording of the question instead.
- Quote CSV cells that contain commas, quotes, or line breaks.
- Escape quotes inside CSV cells by doubling them.

## Game And Sheet Names

| Game | Sheet |
| --- | --- |
| Normal Game | Questions |
| Quick Fire Quiz | Quiz |
| This or That | This or That |
| Most Likely To | Most Like To |
| Put Your Points Where Your Mouth Is | Put Your Money Where Your Mouth Is |
| True or False | True or False |
| Red Flag Green Flag | Red Flag Green Flag |
| Compatibility Meter | Compatibility |
| Memory Lane | Memory Lane |

## Question Types

Supported question types include:

- Favourite
- Fill in the Blank
- Multiple Choice
- Numeric
- Open Answer
- Pet Peeve
- Preference
- Ranked / Top 3
- Ranking
- Rating
- Text Answer
- True or False
- Who is more likely to
- Would you rather
- Sort Into Order

## Default Answer Types

- Text-style rows: `text`
- Favourite: `text`
- Fill in the Blank: `text`
- Open Answer: `text`
- Pet Peeve: `text`
- Multiple Choice: `multipleChoice`
- Preference: `multipleChoice`
- Would you rather: `multipleChoice`
- True or False: `multipleChoice`
- Who is more likely to: `multipleChoice`
- Numeric: `number`
- Rating: `number`
- Ranked / Top 3: `ranked`
- Ranking: `ranked`
- Sort Into Order: `ranked`

## Strict Anti-Repetition Rules

- Do not generate rows by taking a small list of option pairs and wrapping each pair in repeated sentence templates.
- Do not reuse a question concept, option pair, opening phrase, category pairing, or repeat group unless the row is genuinely asking something different.
- No two rows may have the same question after lowercasing and removing punctuation.
- No two rows may have the same options value after lowercasing and sorting the choices, except fixed-choice games where the app supplies the options.
- No more than 5% of rows may begin with the same first 4 words.
- Do not add filler words such as "right now", "tonight", "today", "secretly", or "honestly" repeatedly to make duplicates look unique.
- Category, tone, relationship area, tags, game suitability, AI use case, and repeat group must be chosen because they fit the actual question.
- Spread rows across the requested categories.
- Use varied sentence shapes.
- Never use placeholder options such as `Option A`, `Option B`, `Player 1`, or `Player 2`.

## Game-Specific Rules

### Normal Game

- Players answer their own answer and guess the other player answer.
- Use a wide mix of question types.
- For Multiple Choice, Preference, and Sort Into Order, fill `Options` with specific choices separated by pipes.
- For text, favourite, pet peeve, numeric, rating, and ranked rows, leave `Options` blank unless fixed choices are needed.

### Quick Fire Quiz

- Host marks answers correct or incorrect.
- `Correct Answer` is mandatory for every row.
- Multiple Choice rows need options that include the correct answer plus believable wrong answers.
- True or False rows should put `Correct Answer` as `True` or `False`.
- Keep prompts short enough to answer quickly.

### This or That

- Every row is a genuine two-choice preference.
- `Question Type` should be `Preference`.
- `Options` must contain exactly two choices separated by ` | `.
- Every option pair must be unique across the whole CSV.
- Category and relationship area must directly match the two choices.

### Most Likely To

- Players vote `Jay`, `Kim`, `Both`, or `Neither`.
- Leave `Options` blank because the app supplies fixed choices.
- Prompts should clearly imply "Who is most likely to".
- Avoid prompts where only one player could ever reasonably be chosen.

### Put Your Points Where Your Mouth Is

- A random stake is chosen, players answer and guess, host marks match or miss.
- Use varied question types.
- Do not use `Jay`, `Kim`, `Both`, `Neither` as generic options unless the prompt is genuinely "who is more likely".
- For Sort Into Order, put every sortable item in `Options`.
- For Ranked / Top 3, ask for exactly three answers unless options specify a fixed list.

### True or False

- Write standalone statements, not questions.
- Do not add numeric codes or IDs.
- Leave `Options` blank.
- Leave `Correct Answer` blank for the True or False game unless explicitly asked otherwise.
- Mix statements about Jay, Kim, and both players.

### Red Flag Green Flag

- Players judge each scenario as `Green Flag`, `Red Flag`, or `Depends`.
- Leave `Options` blank because the app supplies fixed choices.
- Make the scenario debatable rather than obviously good or bad.

### Compatibility Meter

- Both players answer privately, then compatibility is scored at the end.
- Use questions where two answers can be compared.
- Multiple Choice and Preference rows should include clear options.
- Rating rows should make the 1 to 10 scale obvious.
- Avoid factual quiz questions.

### Memory Lane

- Mix fresh memory prompts with recall-style prompts.
- Most rows should use `Memory Lane Mode` = `memoryPrompt`.
- Only use `pastAnswerRecall` when deliberately making a recall-style row.
- Recall rows need `Correct Answer` and options that include the correct answer plus believable distractors.

## Required Self-Check Before Output

Before returning a CSV, silently audit for:

- duplicate questions
- repeated option pairs
- repeated opening phrases
- random or mismatched categories
- missing options where options are required
- wrong sheet/game values
- wrong column count
- invalid question type for the selected game
- non-numeric intensity values
- wrong number of data rows

Rewrite failed rows before output.

## Using Current Remaining Question Exports

The KJK app can export a selected game's current remaining questions. These are active questions that have not already been used or reserved in a live game.

When the user uploads a current remaining questions CSV:

- Treat it as the live "do not repeat" list for that game.
- Do not generate any question that is the same or near-identical to a question in that file.
- Do not reuse the same option pair from that file for games like This or That, Preference, Multiple Choice, Would You Rather, Ranking, or Sort Into Order.
- Prefer new concepts, not just different wording for an existing concept.
- If both a question ledger and a current remaining export are uploaded, avoid duplicates against both.
