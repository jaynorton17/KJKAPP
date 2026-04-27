# Copilot Instructions for KJKAPP

You are working on the KJK app.

This repo already has a specialist agent system. Do not ignore it.

Before making changes, always read:
- AGENTS.md
- PROJECT_MAP.md
- FEATURE_LOG.md
- BUG_RULES.md

If the task matches a specialist area, also read the relevant owner file under `codex-areas/`:

- `codex-areas/manager/AGENTS.md` for triage/routing
- `codex-areas/app-shell/AGENTS.md` for app boundaries, shared state, imports, entry points, and cross-owner integration
- `codex-areas/game-stability/AGENTS.md` for live game room, answer entry, scoring, penalty points, reveal, chat, focus, and flicker stability
- `codex-areas/quiz/AGENTS.md` for Quick Fire Quiz, wagers, ready screens, timers, quiz scoring, reveal, and overrides
- `codex-areas/lobby/AGENTS.md` for create game, join game, resume, invites, pending/active/previous games, and lifecycle
- `codex-areas/data/AGENTS.md` for Firebase, Firestore, listeners, Google Sheets, imports, persistence, rules, and indexes
- `codex-areas/analytics/AGENTS.md` for analytics dashboards, question insights, likes/dislikes, quiz analytics, and summary panels
- `codex-areas/store-diary/AGENTS.md` for forfeits, redemption, AMA, diary, profile, and private notes
- `codex-areas/ui-styling/AGENTS.md` for headers, navigation, pills, icons, spacing, responsiveness, and CSS-only visual changes

Core repo rules:
- Treat `src/ProductionApp.jsx` as the production app unless the task explicitly says otherwise.
- Do not treat `src/App.jsx` as the live product unless explicitly instructed.
- Inspect relevant files before editing.
- Make the smallest safe change.
- Preserve existing behaviour unless the request explicitly changes it.
- Avoid unrelated refactors, renames, rewrites, or style churn.
- Prefer existing patterns in `ProductionApp.jsx` and `src/styles.css`.
- Do not remove features just because they look unused.
- Do not surface raw Google Sheet URLs in player-facing UI.

Live stability rules:
- Do not introduce blinking or flickering.
- Do not remount answer forms while users type.
- Do not reset answer inputs during realtime updates.
- Do not steal focus from text boxes.
- Avoid unstable React keys.
- Avoid tying major room rendering to timers, `Date.now()`, `Math.random()`, message counts, answer counts, or transient `updatedAt` values.
- Keep normal game penalty scoring and Quick Fire Quiz scoring separate.

Firebase/data rules:
- Be careful with Firestore snapshot merges.
- Scope listeners and updates narrowly.
- Preserve in-progress round state when snapshots temporarily omit fields.
- For Firebase/config/import changes, inspect the relevant files named in `AGENTS.md` and `PROJECT_MAP.md`.

UI rules:
- Keep top bars, pills, badges, and control rows compact.
- Do not let header controls overlap gameplay content.
- Keep question and answer areas readable on desktop and mobile.
- Check mobile layout when changing room, lobby, dashboard, analytics, diary, or store UI.

Completion rules:
- Run `npm run build` before finishing if code or build-affecting docs changed.
- Report changed files.
- Report root cause.
- Report build result.
- Report known risks and assumptions.
- Do not deploy unless explicitly told to deploy.
