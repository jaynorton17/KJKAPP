# Quiz Game State Skill

Use this when editing quiz phases, ready states, transitions, or rejoin behaviour.

Required flow:
1. Wager entered.
2. Both players click Ready.
3. Question appears.
4. 10-second timer starts.
5. Each player submits.
6. Timer stops individually per player.
7. Reveal screen appears after both answer or timer reaches zero.
8. Answer boxes are covered/hidden first.
9. Answer boxes flash green/red, then settle green/red.
10. Scores update once only.
11. Both players click Ready.
12. Next question appears only when both are ready.

Rules:
- Never show the next question until both players are ready.
- Never reset submitted answers unless starting a new question.
- Never award points twice for the same player/question.
- Preserve phase after refresh/rejoin.
- Inspect existing state names and Firebase fields before editing.
