# Testing Checklist Skill

Use this before finishing any quiz-related change.

Build:
- Run npm install only if needed.
- Run npm run build.
- Fix build errors caused by the change.

Manual flow:
- Create quiz game.
- Enter wager.
- Both players ready.
- Question appears and timer starts.
- Player 1 submits early.
- Player 2 submits later.
- Reveal screen appears.
- Answers are covered at first.
- Answer boxes flash green/red.
- Flashing stops and boxes settle green/red.
- Scores update correctly once.
- Both players ready.
- Next question appears.

Edge cases:
- Timeout.
- Wrong answer.
- Correct answer.
- Case-insensitive answers: Paris, paris, PARIS.
- Refresh mid-question and mid-reveal.
- No repeat questions.
- No input focus loss or flicker.

Report files changed, what was fixed, what was tested, and remaining risk.
