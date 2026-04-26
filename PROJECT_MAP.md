# PROJECT_MAP.md

## Repo Overview
- `src/main.jsx`: app bootstrap. Currently renders `ProductionApp.jsx` and global `styles.css`.
- `src/ProductionApp.jsx`: production app shell and most live application logic. This is the main file for auth, dashboard tabs, lobby, live rooms, quiz mode, profile, notes, analytics hub, diary, forfeit store, Firestore listeners, and deploy-facing behavior.
- `src/App.jsx`: older/local app implementation with tabbed local game/question/history/analytics/export/settings flow. Useful as legacy context but not the current production entry.
- `src/components/`: reusable/legacy UI pieces. Some are used by `ProductionApp.jsx` (`AnalyticsPanel`, `MainScoreboard16x9`), others mainly support the older `App.jsx`.
- `src/utils/game.js`: core data helpers, question templates, round types, categories, analytics calculations, scoring helpers, and general game math.
- `src/utils/importers.js`: import parsing, Google Sheet parsing, CSV/text/JSON import logic, plus quiz-sheet parsing helpers.
- `src/utils/storage.js`: localStorage helpers for the older/local app state and theme/sound persistence.
- `src/lib/firebase.js`: Firebase app/auth/firestore/storage/analytics bootstrap from Vite env vars.
- `src/styles.css`: single large global stylesheet for lobby, room, analytics, diary, store, mobile rules, pills, headers, and frame layouts.
- `scripts/import-sheet-to-firestore.mjs`: Node script for syncing/importing the Firestore question bank from Google Sheets and creating debug games.
- `public/templates/`: question import templates and Google Sheet template files.
- `firebase.json`, `firestore.rules`, `firestore.indexes.json`: hosting and Firestore config.

## Framework And Architecture
- Framework: React 19 with Vite.
- Data/backend: Firebase Auth, Firestore, Storage, optional Analytics.
- Routing: no router detected. The app is a single-screen stateful dashboard controlled by local tab state.
- Styling: one large global CSS file (`src/styles.css`), not CSS modules.

## Main Pages / Views
- Dashboard tabs in `ProductionApp.jsx`:
  - `gameLobby`
  - `questionBank`
  - `analytics`
  - `diary`
  - `forfeitStore`
- A live room view is rendered when a game is open (`GameRoomView` inside `ProductionApp.jsx`).
- My Profile is a modal/panel inside `ProductionApp.jsx`, not a separate routed page.

## Important Production Areas

### Auth / Profile
- Firebase auth setup and profile loading live in `ProductionApp.jsx` and `src/lib/firebase.js`.
- Display name editing is handled in the My Profile modal in `ProductionApp.jsx`.

### Game Lobby / Create / Join
- Game Lobby UI and dashboard menu live in `ProductionApp.jsx`.
- Create Game, Create Quiz Game, invite sending, and join-by-code/session logic are in `ProductionApp.jsx`.
- Pending/active/previous game activity also lives in `ProductionApp.jsx`.

### Active / Previous / Pending Games
- Firestore listeners for the current game, rounds, and chat are in `ProductionApp.jsx`.
- Resume/joinability logic, invite acceptance, and activity cards are in `ProductionApp.jsx`.
- Previous/completed game summaries are also handled there, with summary analytics rendered via `AnalyticsPanel`.

### Live Room / Gameplay
- `GameRoomView` in `ProductionApp.jsx` renders the live room.
- `RoomActiveFrame`, `QuestionAnswerEntry`, reveal cards, quiz setup, and room chat all live in `ProductionApp.jsx`.
- `MainScoreboard16x9` is used for the large board visual.

### Question Bank / Import / Sync
- Production question-bank page is in `ProductionApp.jsx`.
- Legacy question-bank editing UI also exists in `src/components/QuestionBankPanel.jsx`.
- Parsing/sync logic is in `src/utils/importers.js`.
- Firestore question bank collection is `questionBank`.
- Production code distinguishes `bankType` / `questionBankType` values for normal game vs quiz.

### Normal Game Questions
- Core normal-game scoring and round helpers live in `src/utils/game.js`.
- Standard live answer/guess flow is in `ProductionApp.jsx`.
- Replay, like/dislike, and private flag/note behavior are handled in `ProductionApp.jsx`.

### Quick Fire Quiz
- Quiz detection, wager flow, quiz answer evaluation, timer points, overrides, reveal handling, and quiz analytics live in `ProductionApp.jsx`.
- Quiz parsing support lives in `src/utils/importers.js` via quiz-sheet import helpers.
- Quiz answers are stored separately in Firestore (`quizAnswers`).

### Scoring / Penalty Points
- Penalty scoring helpers and analytics are in `src/utils/game.js`.
- Live penalty drafts and reveal math are in `ProductionApp.jsx`.
- Quiz score and penalty score are separate concepts in production code.

### Analytics
- General round analytics are calculated in `src/utils/game.js`.
- Main analytics rendering lives in `src/components/AnalyticsPanel.jsx`.
- Production dashboard analytics segmentation (`Game Facts`, `Questions`, `Quiz`) is in `ProductionApp.jsx`.

### Forfeit Store / AMA / Profile
- Forfeit store, AMA flow, redemption items, price requests, and diary entry creation live in `ProductionApp.jsx`.
- My Profile modal and flagged note list also live there.

### Diary
- Diary UI, AMA chapter rendering, frozen analytics snapshots, and media blocks all live in `ProductionApp.jsx`.
- Diary styles are in `src/styles.css`.

## Entry Files And Scripts
- Entry JS: `src/main.jsx`
- Production app: `src/ProductionApp.jsx`
- Legacy app: `src/App.jsx`
- Build scripts from `package.json`:
  - `npm run start`
  - `npm run build`
  - `npm run preview`

## Known Fragile Areas
- `src/ProductionApp.jsx` is very large and state-dense; many features share one file.
- Live Firestore snapshot handling is fragile around `currentRound` replacement/remount behavior.
- Answer-entry focus stability depends on stable round identity, memoization, and avoiding transient `currentRound` loss.
- Room rendering is sensitive to timers, toasts, and broad parent state updates.
- Styles are centralized in one large CSS file, so unrelated layout regressions are easy to introduce.
- There are both legacy and production implementations in the repo; future edits must verify which one is actually active before changing code.
