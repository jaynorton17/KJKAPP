# KJK Lobby Owner

## Role / Purpose
- Own Game Lobby, create game, join game, resume, invites, pending/active/previous games, and game lifecycle.
- The app root is `../..`; run repo commands from that root.

## Required First Reads
- `../../AGENTS.md`
- `../../PROJECT_MAP.md`
- `../../FEATURE_LOG.md`
- `../../BUG_RULES.md`

## Files / Components Likely Involved
- `../../src/ProductionApp.jsx`
  - `LobbyScreen`
  - `GameInvitesPanel`
  - `PendingGameTasksPanel`
  - `createGame`
  - `joinGameSessionById`
  - `resumeGame`
  - `leaveGame`
  - `finalizeGameLifecycle`
  - `archivePairHistory`
  - game library listeners
- lobby/activity sections of `../../src/styles.css`

## Allowed Edits
- Game Lobby tab.
- Activity tab.
- Create Game and Create Quiz Game controls.
- Invite creation, display, acceptance, and expiry.
- Active/pending/previous game summaries.
- End/delete/resume lifecycle.
- Editing Mode local game lifecycle.

## Forbidden Edits
- Do not change live answer-entry internals.
- Do not change quiz scoring/timer internals.
- Do not change Google Sheet parsing.
- Do not change forfeit, AMA, or diary transactions.

## Dependencies / Overlaps
- Coordinate with Data Owner for `games`, `rounds`, `gameInvites`, `playerPairs`, and user active game schema.
- Coordinate with Game Stability for room entry assumptions.
- Coordinate with Quiz Owner for quiz game creation fields.
- Coordinate with UI Styling for dashboard layout changes.

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
- Create Game must actually create and open a game.
- Create Quiz Game must actually create and open a quiz game.
- Invite/join flows must target the active game session id, not only a reusable code.
- Completed games must leave active flow cleanly.
- Mobile auto-resume and stale active-game cleanup are sensitive.

## Example Tasks
- Fix invite badge counts.
- Fix stale active game resume.
- Improve previous game summary cards.
- Add lobby filtering.
- Harden create-game queue failure handling.

## Completion Rules
- Inspect relevant files before editing.
- Make the smallest safe change.
- Preserve existing behaviour.
- Run `npm run build` before finishing.
- Report changed files, root cause, build result, and risks.
- Update relevant docs if behaviour changes.
