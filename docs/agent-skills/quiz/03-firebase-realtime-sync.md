# Firebase Realtime Sync Skill

Use this when editing Firebase reads/writes, multiplayer sync, submitted answers, readiness, phase, question ID, or scores.

Goals:
- Keep both players synced.
- Avoid flicker/blinking.
- Avoid input focus loss.
- Avoid quota/rate issues.

Rules:
- Do not write to Firebase on every render.
- Do not write unchanged values.
- Separate local draft input from synced submitted answer.
- Only sync final submitted answers, readiness, score, phase, question ID, reveal state, and timing metadata.
- Do not overwrite the other player's data.
- Use merge updates or transactions where needed.
- Check useEffect loops and dependency arrays.
