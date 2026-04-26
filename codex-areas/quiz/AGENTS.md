# KJK Quiz Owner

## Role / Purpose
- Own Quick Fire Quiz behavior: wagers, ready screens, timers, points countdown, quiz scoring, quiz reveal, and overrides.
- The app root is `../..`; run repo commands from that root.

## Required First Reads
- `../../AGENTS.md`
- `../../PROJECT_MAP.md`
- `../../FEATURE_LOG.md`
- `../../BUG_RULES.md`

## Files / Components Likely Involved
- `../../src/ProductionApp.jsx`
  - quiz helpers near the top of the file
  - `QuizSetupStagePanel`
  - `QuizLiveStatus`
  - quiz branches in `RoomActiveFrame`
  - `saveQuizWager`
  - `requestQuizOverride`
  - `respondQuizOverride`
  - quiz branches in `submitAnswer`, `markReady`, and `nextQuestion`
  - quiz auto-launch, auto-advance, and timeout effects
- `../../src/utils/importers.js`
- `../../src/utils/game.js`
- quiz-related sections of `../../src/styles.css`

## Allowed Edits
- Quiz question evaluation.
- Quiz timer and point countdown behavior.
- Wager flow.
- Setup and next-question ready gates.
- Quiz answer analytics writes.
- Override/dispute flow.
- Quiz reveal display.

## Forbidden Edits
- Do not change normal game penalty behavior without Game Stability coordination.
- Do not apply quiz-only ready rules to normal game.
- Do not change normal question feedback/replay behavior.
- Do not change generic lobby layout beyond quiz create controls without Lobby/UI coordination.

## Dependencies / Overlaps
- Coordinate with Data Owner for `questionBank`, `bankType: quiz`, Google Sheet quiz import, and `quizAnswers`.
- Coordinate with Game Stability because quiz uses shared live room components.
- Coordinate with Analytics Owner for quiz analytics display.

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
- Quiz score and penalty points are separate.
- Timer state must stay isolated from answer-entry remounts.
- Override writes touch both `games.currentRound` and `quizAnswers`.
- First question and next question must wait for the appropriate ready gates.
- Quiz questions should not repeat unless explicitly changed.

## Example Tasks
- Fix quiz timer scoring.
- Fix ready screen launch race.
- Add a quiz question type.
- Improve override UX.
- Fix quiz reveal totals.

## Completion Rules
- Inspect relevant files before editing.
- Make the smallest safe change.
- Preserve existing behaviour.
- Run `npm run build` before finishing.
- Report changed files, root cause, build result, and risks.
- Update relevant docs if behaviour changes.
