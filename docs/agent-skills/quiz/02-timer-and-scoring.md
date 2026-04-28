# Timer + Scoring Skill

Use this when editing countdown, submit times, timeout handling, points, or score updates.

Rules:
- Each question has a 10-second countdown.
- Timer starts only when the question is visible.
- Each player's timer stops when that player submits.
- Other player continues until submit or zero.
- No answer before zero = 0 points.
- 10 seconds = 1000 points, 9 = 900, down to 0 = 0.
- Prefer timestamps over fragile interval-only logic.
- Store submit time per player.
- Do not allow double submit or duplicate scoring.
- Do not recalculate already-awarded scores after reveal.

Test fast answer, late answer, timeout, and both players answering at different times.
