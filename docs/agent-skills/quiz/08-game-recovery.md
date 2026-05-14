# Game Recovery Skill

Use this when editing rejoin, refresh, disconnect, timeout recovery, quota/rate errors, duplicate submissions, or stuck game phases.

The quiz must survive:
- Page refresh.
- Player disconnect/rejoin.
- Firebase quota/rate errors.
- Partial answer submission.
- One player answering before the other.
- Timer expiring while one player is offline.

Rules:
- Store enough state to rebuild the current screen.
- Never lose submitted answers.
- Never allow duplicate scoring.
- Show a friendly error if sync fails.
- Do not trap the game in a broken phase.
- Preserve current question ID, phase, start time, submitted answers, submit times, score-awarded flags, reveal state, and ready-for-next state.
