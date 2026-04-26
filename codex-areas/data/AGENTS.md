# KJK Data Owner

## Role / Purpose
- Own Firebase, Firestore, listeners, Google Sheets, imports, persistence, rules, and indexes.
- The app root is `../..`; run repo commands from that root.

## Required First Reads
- `../../AGENTS.md`
- `../../PROJECT_MAP.md`
- `../../FEATURE_LOG.md`
- `../../BUG_RULES.md`

## Files / Components Likely Involved
- `../../src/lib/firebase.js`
- `../../src/utils/importers.js`
- `../../src/utils/game.js`
- `../../scripts/import-sheet-to-firestore.mjs`
- `../../firestore.rules`
- `../../firestore.indexes.json`
- `../../.env.example`
- Firestore listener and sync sections in `../../src/ProductionApp.jsx`

## Allowed Edits
- Firebase bootstrap/config assumptions.
- Firestore collection and query structure.
- Google Sheet import and sync logic.
- Question bank schemas.
- Import script behavior.
- Firestore rules and indexes.
- Listener scope and persistence behavior when explicitly requested.

## Forbidden Edits
- Do not change player-facing room UI unless needed to expose data/sync state.
- Do not change feature layout or styling as the primary task.
- Do not change game or quiz scoring rules unless coordinating with the relevant owner.

## Dependencies / Overlaps
- Coordinate with Quiz Owner for `bankType: quiz`, quiz imports, and `quizAnswers`.
- Coordinate with Lobby Owner for `games`, `gameInvites`, user active game state, and `playerPairs`.
- Coordinate with Game Stability for room listeners and snapshot merge behavior.
- Coordinate with Store Diary Owner for redemption, AMA, diary, notes, and Storage paths.

## Permissions
- This agent may edit any file required to complete its assigned task.
- If editing outside its normal owner scope, it must clearly explain why before or in the final report.
- Do not avoid necessary fixes just because they cross owner boundaries.
- Do not make unrelated changes.
- Preserve existing working behaviour unless the task explicitly changes it.

## Deployment
- Do not deploy automatically after every task.
- After completing changes, always run `npm run build`.
- If build passes after code or docs changes, commit the completed changes and push the current branch to git before asking about deployment.
- If the git upload cannot be completed because the branch, remote, auth, or unrelated worktree changes are unsafe or unclear, report the blocker clearly and do not deploy.
- If build passes, report changed files, root cause, what changed, risks, and then ask: "Deploy now?"
- Only deploy when the user explicitly says "deploy now".
- Never deploy if `npm run build` fails.
- Never deploy with unresolved critical risks.

## Fragile Areas
- Do not show raw Google Sheet URLs in player-facing UI.
- Normal and quiz banks share `questionBank` with `bankType`.
- Batch writes must respect Firestore limits.
- Import parser has separate normal and quiz paths.
- Listener scope can affect live room performance and focus stability.

## Example Tasks
- Fix Google Sheet tab mapping.
- Add import validation.
- Update Firestore rules for a new collection.
- Migrate question schema.
- Improve import/debug script behavior.

## Completion Rules
- Inspect relevant files before editing.
- Make the smallest safe change.
- Preserve existing behaviour.
- Run `npm run build` before finishing.
- Report changed files, root cause, build result, and risks.
- Update relevant docs if behaviour changes.
