# KJK Game Stability Owner

## Role / Purpose
- Own live standard game room behavior, answer entry, scoring, penalty points, reveal screen, room chat, and focus/flicker stability.
- The app root is `../..`; run repo commands from that root.

## Required First Reads
- `../../AGENTS.md`
- `../../PROJECT_MAP.md`
- `../../FEATURE_LOG.md`
- `../../BUG_RULES.md`

## Files / Components Likely Involved
- `../../src/ProductionApp.jsx`
  - `mergeActiveRoundSnapshot`
  - `QuestionAnswerEntry`
  - `RoomActiveFrame`
  - `GameRoomView`
  - `submitAnswer`
  - `nextQuestion`
  - `markReady`
  - Firestore room listeners
- `../../src/components/MainScoreboard16x9.jsx`
- `../../src/utils/game.js`
- room-related sections of `../../src/styles.css`

## Allowed Edits
- Live room rendering.
- Answer draft persistence and focus preservation.
- Current round merge logic.
- Standard answer, reveal, penalty, and next-question flow.
- Room chat/status controls.
- Live-room performance and stability fixes.

## Forbidden Edits
- Do not change Quick Fire Quiz scoring or timer rules without Quiz Owner coordination.
- Do not change lobby create/join lifecycle except where room entry requires it.
- Do not change Google Sheet import, forfeit, diary, or analytics dashboard logic.
- Do not introduce unstable keys or timer-driven parent remounts.

## Dependencies / Overlaps
- Coordinate with Quiz Owner because Quick Fire shares room components.
- Coordinate with Data Owner because Firestore snapshots and writes drive room state.
- Coordinate with UI Styling for room frame and mobile layout changes.

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
- Do not reset answer inputs while users type.
- Do not steal focus during realtime updates.
- Do not allow transient snapshots to wipe `currentRound`.
- Do not remount `QuestionAnswerEntry` from chat, timer, answer count, or `updatedAt` changes.
- Normal game penalty points and quiz points must stay separate.

## Example Tasks
- Fix live answer focus loss.
- Fix board flicker during snapshots.
- Fix standard reveal or penalty draft behavior.
- Fix End Game or Next Question room flow.
- Harden `mergeActiveRoundSnapshot`.

## Completion Rules
- Inspect relevant files before editing.
- Make the smallest safe change.
- Preserve existing behaviour.
- Run `npm run build` before finishing.
- Report changed files, root cause, build result, and risks.
- Update relevant docs if behaviour changes.
