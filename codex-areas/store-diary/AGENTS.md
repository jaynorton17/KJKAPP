# KJK Store Diary Owner

## Role / Purpose
- Own forfeits, redemption, AMA, diary, profile, and private notes.
- The app root is `../..`; run repo commands from that root.

## Required First Reads
- `../../AGENTS.md`
- `../../PROJECT_MAP.md`
- `../../FEATURE_LOG.md`
- `../../BUG_RULES.md`

## Files / Components Likely Involved
- `../../src/ProductionApp.jsx`
  - `RedemptionStoreSection`
  - `DiaryDashboardSection`
  - `AmaTasksPanel`
  - `ForfeitAlertsPanel`
  - `PendingRedemptionsPanel`
  - My Profile modal
  - redemption, AMA, diary, and private-note handlers
- `../../src/lib/firebase.js` for Storage usage
- diary/store/profile sections of `../../src/styles.css`

## Allowed Edits
- Forfeit items and price requests.
- Redemption transactions.
- AMA fixed store item behavior.
- AMA question/answer lifecycle.
- Diary chapter editing and display.
- Private question notes and profile UI.
- AMA media upload handling.

## Forbidden Edits
- Do not change standard or quiz live game flow.
- Do not change question bank import.
- Do not change generic analytics calculations except diary snapshot consumption.
- Do not expose private notes across users.

## Dependencies / Overlaps
- Coordinate with Data Owner for `redemptionItems`, `redemptionHistory`, `forfeitPriceRequests`, `amaRequests`, `diaryEntries`, user note subcollections, and Storage paths.
- Coordinate with Analytics Owner for frozen analytics snapshots.
- Coordinate with UI Styling for store, diary, profile, and modal layout.

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
- Identity matching mixes Firebase UID, fixed player aliases, display names, and seats.
- AMA touches redemption history, AMA requests, diary entries, and Storage.
- Private question notes must stay private by user id.
- Store owner/requester semantics are easy to invert.

## Example Tasks
- Fix forfeit request ownership.
- Add diary media handling.
- Improve AMA completion notifications.
- Fix profile note editing.
- Add completed-forfeit history view.

## Completion Rules
- Inspect relevant files before editing.
- Make the smallest safe change.
- Preserve existing behaviour.
- Run `npm run build` before finishing.
- Report changed files, root cause, build result, and risks.
- Update relevant docs if behaviour changes.
