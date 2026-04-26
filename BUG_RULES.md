# BUG_RULES.md

## Permanent Do-Not-Break Rules
- Do not cause screen blinking/flickering during polling, timers, or realtime Firestore updates.
- Do not reset answer inputs while users type.
- Do not steal focus from text boxes during re-renders.
- Do not clear answer boxes unless the question actually changes or the user intentionally resets/edits.
- Do not make top bars, header rows, or pills huge.
- Keep active/pending/previous lobby bars consistent and compact.
- Keep Jay/Kim labels, flags, and score visibility aligned with the current header/frame intent.
- Do not overlap top-right controls, menu buttons, pills, or status badges.
- End Game must really end the active game and move it out of active flow.
- Default penalty input should remain `0` where that behavior is expected.
- Question and answers must stay inside the main game frame on desktop and mobile.
- Do not show full Google Sheet URLs in visible player-facing UI.
- Create Game must actually create/open a game.
- Create Quiz Game must actually create/open a quiz game.
- Invite/join flows must continue to target the active game session id, not just a reusable code.
- Avoid introducing undefined variables or missing references such as `categoryColorMap` / `viewerLabel`-style regressions.
- Preserve existing working features unless the task explicitly says to change them.
- Always run `npm run build` before finishing if available.

## Realtime / Focus Rules
- Do not use unstable keys on live room components.
- Do not key live answer panels off `Date.now()`, `Math.random()`, transient `updatedAt`, chat count, or answer count.
- Do not allow transient snapshots to wipe `currentRound` and remount the board.
- Keep local answer drafts local; do not overwrite them from parent state on every keystroke.
- Avoid broad `setGame`/parent updates that repaint the active answer board for unrelated changes.
- Keep timers isolated from the text-entry component tree where possible.

## Layout Rules
- Submit/Edit buttons must not cover inputs.
- Answer options must not overlap labels or other controls.
- Mobile answer panels should stack cleanly.
- Header pills and question metadata must wrap inside the frame instead of overflowing.

## Product-Specific Rules
- Normal game and Quick Fire Quiz have different flows; do not accidentally apply quiz-only `ready` rules to the normal game.
- Quiz score and penalty points are separate; do not merge them by accident.
- Private question notes must stay private by user id.
- Replay behavior applies to normal game questions, not quiz questions, unless explicitly changed.

## Manual Regression Checklist: Live Answer Focus
- Start a live two-player game, not Editing Mode.
- Load an active question and click into the current player's answer box.
- Type continuously for at least 30 seconds while the second browser/player triggers normal live updates, chat, score/header changes, and/or answer submission.
- Confirm the cursor stays in the same answer box and the typed draft remains intact.
- Confirm the game board does not blink, show a temporary loading screen, or swap back to the idle scoreboard during background updates.
- Confirm the answer form does not remount while typing; focus should only leave after submit, leaving the room, a real question change, or game end.
- Submit the answer and confirm the reveal appears only after both players have submitted.
- Move to the next question and confirm the draft resets because the question identity changed.
- Repeat the same focus check for Quick Fire Quiz while the timer counts down.
