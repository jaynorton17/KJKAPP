# FEATURE_LOG.md

## Confirmed Implemented Features Found In Code
- React/Vite single-page app with Firebase Auth, Firestore, Storage, and optional Analytics.
- Production app entry uses `src/ProductionApp.jsx`.
- Game Lobby with:
  - Create Game
  - Join by code
  - Create Quiz Game
  - Create + Invite flows
  - active/pending/previous game activity views
- Invite system tied to a live `gameId`/session, not only a reusable code.
- Resume active game logic and joinability validation.
- Question Bank as its own dashboard view, with segmented `Game Questions` and `Quiz Questions` tabs.
- Google Sheet sync/import support for normal questions and quiz questions from the shared sheet file.
- Quick Fire Quiz mode exists in code.
- Quiz question evaluation supports text normalization, true/false, and multiple choice logic.
- Quiz wager flow exists in code.
- Quiz pre-question ready flow exists in code.
- Quiz timer bar and visible live point countdown exist in code.
- Quiz points are stored per player answer and locked on submit.
- Quiz reveal uses correct/incorrect states and quiz totals.
- Quiz override/dispute flow exists, including requester/approver logic.
- Quiz analytics segment exists in the Analytics page.
- Analytics page segmentation exists with `Game Facts`, `Questions`, and `Quiz`.
- Normal game question feedback exists with `liked` / `disliked`.
- Replay request behavior exists for normal game questions.
- Flag/private question note flow exists.
- My Profile modal exists and supports display-name editing.
- Flagged question notes are shown in My Profile and are keyed per user.
- Diary view exists with book-like open/close behavior and AMA/frozen analytics content.
- Forfeit Store / AMA / request / pricing flows exist in code.
- Notification badges for pending lobby activity/invites exist.
- Editing/Test Mode exists with local-only game behavior and no live persistence for those sessions.

## Partially Implemented Features
- Quick Fire Quiz round flow is implemented, but recent work indicates the live room remains fragile around render/focus stability. Treat quiz live input stability as implemented but historically fragile.
- Standard live game render stability has been patched repeatedly; protections exist, but this area should still be treated as fragile rather than “fully solved forever”.
- Question Bank has both production dashboard handling and an older dedicated component (`src/components/QuestionBankPanel.jsx`). The production dashboard is confirmed; the older component appears to be legacy/secondary.
- Analytics for likes/dislikes and quiz behavior are present, but future prompts should confirm exact downstream calculations before changing or relying on them.
- Replay eligibility is implemented, but future prompts should verify draw-pool behavior before changing retirement/replay rules.

## Requested / Planned Features Not Confirmed In Code
- Any future redesigns beyond the currently coded diary/book, lobby, and live-room layouts.
- Additional push/email notifications. Only in-app invite/activity badges are confirmed.
- Any new router/page system. Current app is tab/state driven, not route driven.
- Any separate external admin CMS or standalone question-editor app.
- Passkey / Face ID / device PIN quick login remains planned, not implemented as a client-only shortcut. A secure web implementation needs server-side WebAuthn registration and assertion challenge verification, then Firebase custom-token sign-in; the current React/Vite/Firebase client does not include that server path.

## Requested Behaviors Checked Against Code

### Quick Fire Quiz
- Quick Fire Quiz mode using the same Google Sheet file but a different sheet/tab:
  - Confirmed in code.
- Quiz starts after wager is entered and both players press ready:
  - Confirmed in code.
- First question appears only when both are ready:
  - Confirmed in code.
- Timer starts with visible countdown/points countdown:
  - Confirmed in code.
- Each player’s timer/score locks when they submit:
  - Confirmed in code.
- Answer reveal screen shows green for correct and red for wrong:
  - Confirmed in code.
- Correct player’s points tally increases; wrong player’s tally stays the same:
  - Confirmed in code.
- Next question does not appear until both players press ready again:
  - Confirmed in code.
- Quiz questions are random and not repeated:
  - Confirmed in code, subject to the draw helpers and used-question tracking continuing to behave correctly.

### Normal Game / Question Actions
- Normal game questions can have thumbs up/down feedback:
  - Confirmed in code.
- Normal game questions can have a replay button so they may appear again in future instead of being removed from the available pot:
  - Confirmed in code.
- Questions can be flagged:
  - Confirmed in code.
- Private notes/notepad for questions:
  - Confirmed in code.
- Notes remain private:
  - Confirmed in code via per-user storage/listener paths.

### Analytics / UI
- Analytics should include segmented pills/tabs such as Stats and Questions:
  - Similar behavior confirmed, but exact labels are `Game Facts`, `Questions`, and `Quiz`, not `Stats`.
- Likes/dislikes should feed into analytics:
  - Confirmed in code.
- Forfeit store/profile areas should show the correct owner/request/add behavior:
  - Confirmed in code, but this area is feature-dense and should be re-verified when editing.
- Header/pills/navigation should stay compact and consistent across pages:
  - This is a design rule, not a binary feature. Compact pill/header patterns are present in code, but future changes can still break them.
