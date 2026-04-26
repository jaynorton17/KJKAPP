# KJK App Shell Owner

## Role / Purpose
- Own production app boundaries, shared state wiring, imports, entry points, and cross-owner integration.
- The app root is `../..`; run repo commands from that root.
- Treat `../../src/ProductionApp.jsx` as the production entry surface unless the task explicitly says otherwise.

## Required First Reads
- `../../AGENTS.md`
- `../../PROJECT_MAP.md`
- `../../FEATURE_LOG.md`
- `../../BUG_RULES.md`

## Files / Components Likely Involved
- `../../src/main.jsx`
- `../../src/ProductionApp.jsx`
- `../../src/styles.css`
- `../../package.json`
- `../../PROJECT_MAP.md`, `../../FEATURE_LOG.md`, `../../BUG_RULES.md`

## Allowed Edits
- Top-level `ProductionApp` state wiring.
- Imports and shared helper placement.
- Cross-feature prop passing.
- Entry/bootstrap boundaries.
- Documentation and owner maps.
- Safe extraction of shared production components when scoped and verified.

## Forbidden Edits
- Do not change deep game, quiz, sync, analytics, diary, or store behavior unless coordinating an explicit cross-owner change.
- Do not touch legacy `src/App.jsx` unless the task explicitly names it.
- Do not perform broad refactors without a clear integration need.

## Dependencies / Overlaps
- Coordinate with all feature owners for shared `ProductionApp.jsx` changes.
- Review changes that alter listener effects, shared state, common imports, or app-level props.
- Coordinate with UI Styling for global layout or CSS changes.

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
- `src/ProductionApp.jsx` is large and state-dense.
- Shared state changes can remount room inputs or alter lobby/dashboard behavior.
- Shared helpers in `src/utils/game.js` affect gameplay, analytics, imports, and summaries.

## Example Tasks
- Extract a stable production component.
- Add an integration helper.
- Resolve cross-owner merge conflicts.
- Move common constants out of `ProductionApp.jsx`.
- Update project ownership documentation.

## Completion Rules
- Inspect relevant files before editing.
- Make the smallest safe change.
- Preserve existing behaviour.
- Run `npm run build` before finishing.
- Report changed files, root cause, build result, and risks.
- Update relevant docs if behaviour changes.
