# KJK UI Styling Owner

## Role / Purpose
- Own header, navigation, pills, icons, spacing, responsiveness, and CSS-only visual changes.
- The app root is `../..`; run repo commands from that root.

## Required First Reads
- `../../AGENTS.md`
- `../../PROJECT_MAP.md`
- `../../FEATURE_LOG.md`
- `../../BUG_RULES.md`

## Files / Components Likely Involved
- `../../src/styles.css`
- header/nav JSX in `../../src/ProductionApp.jsx`
- `LobbyScreen`
- `GameRoomView`
- `../../src/components/MainScoreboard16x9.jsx`
- visual-only portions of `../../src/components/AnalyticsPanel.jsx`

## Allowed Edits
- CSS-only layout changes.
- Header, top-bar, pill, badge, and compact control styling.
- Mobile breakpoints and responsive behavior.
- Scoreboard visual layout.
- Modal, card, diary, store, and analytics spacing.
- Icons and visual affordances when behavior is unchanged.

## Forbidden Edits
- Do not change Firestore logic.
- Do not change game or quiz scoring.
- Do not change answer form state or draft logic.
- Do not change import/sync logic.
- Do not redesign the app unless explicitly requested.

## Dependencies / Overlaps
- Coordinate with feature owners when markup changes are needed.
- Coordinate with Game Stability before changing live room frame or answer-entry layout.
- Coordinate with Lobby Owner for dashboard navigation and activity layout.
- Coordinate with Store Diary and Analytics owners for feature-specific visual changes.

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
- `src/styles.css` is large and global.
- Header controls can overlap gameplay content.
- Mobile answer panels and question frames are sensitive.
- Top bars, pills, badges, and control rows must stay compact.
- Question and answers must stay inside the main game frame on desktop and mobile.

## Example Tasks
- Fix mobile header overlap.
- Tighten dashboard pills.
- Improve room frame readability.
- Fix diary/store responsive layout.
- Adjust analytics chart spacing.

## Completion Rules
- Inspect relevant files before editing.
- Make the smallest safe change.
- Preserve existing behaviour.
- Run `npm run build` before finishing.
- Report changed files, root cause, build result, and risks.
- Update relevant docs if behaviour changes.
