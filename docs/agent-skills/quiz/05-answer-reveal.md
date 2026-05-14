# Answer Reveal Skill

Use this when editing the answer reveal screen, answer checking, green/red states, reveal animation, or score display.

Reveal screen must show:
- Question.
- Each player's answer.
- Correct answer.
- Right/wrong state per player.
- Points gained per player.
- Updated total score.

Covered reveal requirement:
- When the answer page first appears, both answer boxes must be covered/hidden.
- Do not immediately expose answers on first render.
- Then reveal both answer boxes with a short animation.
- During reveal, each answer box flashes green/red.
- After the animation, flashing stops and boxes settle:
  - Green if correct.
  - Red if wrong.
  - Red or clear no-answer state for timeout/no answer.

Answer checking:
- Must not be case sensitive.
- Trim whitespace before comparing.
- Use normalised comparison, e.g. lowercased trimmed strings.
- For multiple choice, compare stable option IDs where possible.

Flow rules:
- Reveal appears after both answer or timer reaches zero.
- Scores update once only.
- Do not auto-advance.
- Both players must click Ready before next question appears.
