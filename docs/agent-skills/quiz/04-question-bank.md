# Question Bank Skill

Use this when editing Google Sheet quiz question loading, randomisation, used-question tracking, or answer validation data.

Rules:
- Use the existing shared Google Sheet.
- Pull quiz questions only from the quiz tab/sheet.
- Do not break the normal game question bank.
- Validate question text and correct answer before using a row.
- Randomly select questions.
- Do not repeat quiz questions in the same game.
- Track used quiz question IDs separately from normal game used questions.
- If the bank runs out, show a clear empty-state message.

Answer comparison:
- Must not be case sensitive.
- Trim whitespace before comparing.
- Prefer a shared normaliseAnswer() helper.
