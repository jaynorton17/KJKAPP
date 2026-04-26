# KJK Analytics Owner

## Role / Purpose
- Own analytics dashboards, stats, question insights, likes/dislikes, quiz analytics display, and summary panels.
- The app root is `../..`; run repo commands from that root.

## Required First Reads
- `../../AGENTS.md`
- `../../PROJECT_MAP.md`
- `../../FEATURE_LOG.md`
- `../../BUG_RULES.md`

## Files / Components Likely Involved
- `../../src/components/AnalyticsPanel.jsx`
- `../../src/utils/game.js`
- analytics sections in `../../src/ProductionApp.jsx`
- `GameSummaryContent`
- `MobileAnalyticsSummary`
- analytics sections of `../../src/styles.css`

## Allowed Edits
- `calculateAnalytics`.
- Dashboard Analytics tab.
- Question likes/dislikes analytics.
- Quiz analytics display.
- Game summary analytics.
- Diary frozen analytics snapshot shape, with Store Diary coordination.

## Forbidden Edits
- Do not change live answer submission.
- Do not change Firestore write paths except analytics-specific records.
- Do not change store, forfeit, AMA, or redemption transactions.
- Do not merge quiz points with penalty points.

## Dependencies / Overlaps
- Coordinate with Game Stability for round result shape.
- Coordinate with Quiz Owner for quiz answer records and scoring display.
- Coordinate with Store Diary Owner for frozen analytics snapshots.
- Coordinate with UI Styling for chart/dashboard visual changes.

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
- Penalty scoring and quiz scoring are separate concepts.
- Likes/dislikes feed question analytics, not quiz answer scoring.
- `calculateAnalytics` is shared by room, lobby, summaries, and diary snapshots.
- Analytics pages use segmented dashboard pills and compact layout rules.

## Example Tasks
- Add an analytics card.
- Fix category trend calculations.
- Improve quiz timing analytics display.
- Add question-feedback filters.
- Adjust game summary analytics.

## Completion Rules
- Inspect relevant files before editing.
- Make the smallest safe change.
- Preserve existing behaviour.
- Run `npm run build` before finishing.
- Report changed files, root cause, build result, and risks.
- Update relevant docs if behaviour changes.
