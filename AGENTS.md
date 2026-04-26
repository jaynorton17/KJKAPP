# AGENTS.md

## Purpose
- KJK is a React + Vite + Firebase web app for Jay/Kim relationship gameplay.
- The main live product is implemented in `src/ProductionApp.jsx`.
- The repo also contains an older/local single-device app shell in `src/App.jsx`; treat `ProductionApp.jsx` as the production entry unless a task explicitly says otherwise.

## Run And Build
- Install deps: `npm install`
- Local dev server: `npm run start`
- Production build: `npm run build`
- Preview production build: `npm run preview`
- Firebase hosting config is present (`firebase.json`, `.firebaserc`); production deploys have been using the `kjkkinks` hosting target.

## Likely Checks
- Always run `npm run build` before finishing if the task changes code or docs that affect imports/build output.
- If touching Firebase config assumptions, inspect `src/lib/firebase.js`, `.env.example`, and `.env.local`.
- If touching Google Sheet import/sync behavior, inspect `src/utils/importers.js`, `scripts/import-sheet-to-firestore.mjs`, and the relevant `ProductionApp.jsx` sync handlers.
- If touching live room behavior, inspect the Firestore listeners, `mergeActiveRoundSnapshot`, answer form memoization, and submit paths in `src/ProductionApp.jsx`.

## Coding Rules
- Inspect relevant files before editing; do not infer structure from old prompts alone.
- Preserve existing behavior unless the request explicitly changes it.
- Avoid unrelated refactors, renames, or style churn.
- Keep changes narrow and explain any risk.
- Do not remove features just because they look unused without confirming they are dead.
- Prefer updating existing patterns in `ProductionApp.jsx`/`styles.css` rather than inventing parallel ones.

## UI Rules
- Keep top bars, pills, badges, and control rows compact.
- Do not let header controls overlap gameplay content.
- Keep the main game/question frame readable on desktop and mobile.
- Preserve the current visual language unless the task explicitly asks for redesign.
- Do not surface raw Google Sheet URLs in player-facing UI.

## Stability Rules
- Do not introduce blinking/flickering on live game or quiz screens.
- Do not remount answer forms while users type.
- Do not clear local drafts unless the question actually changes or the user intentionally resets/edits.
- Do not steal focus from inputs during realtime updates.
- Be careful with Firestore snapshots that temporarily omit fields; preserve in-progress round state when appropriate.
- Avoid unstable keys on live room components.
- Avoid tying major component rendering to timers, `Date.now()`, `Math.random()`, message counts, answer counts, or transient `updatedAt` values.

## Realtime / Polling Guidance
- Scope listener updates to the smallest possible state.
- Prefer local timer state inside isolated child components, not in the parent answer board.
- Memoize answer-entry and active-room components if a parent updates frequently for unrelated reasons.
- Do not rewrite whole `currentRound` objects if only one nested answer or flag changed.

## Behavior Preservation
- Standard game and Quick Fire Quiz share infrastructure but have different rules; do not mix their flows.
- Normal game uses penalty-point scoring and answer/guess panels.
- Quick Fire Quiz uses quiz scoring, wagers, timer logic, and quiz-specific reveal/override behavior.
- Manual join by code is a fallback and should remain working unless explicitly removed.

## Completion Rules
- Run `npm run build` before finishing if available.
- If build passes after code or docs changes, commit the completed changes and push the current branch to git before asking about deployment.
- If the git upload cannot be completed because the branch, remote, auth, or unrelated worktree changes are unsafe or unclear, report the blocker clearly and do not deploy.
- Report changed files.
- Report any known risks, assumptions, or areas marked “planned / not confirmed”.
