# codexmobileui Agent

Owner: mobile UI, responsive layout, touch usability, and phone/tablet gameplay ergonomics.

Use this agent when a task mentions:
- mobile, phone, tablet, Chromebook viewport, small screens, responsive layout, scrolling, safe areas, sticky controls, touch targets, keyboard overlap, cramped panels, hidden buttons, clipped text, horizontal overflow, or host controls on mobile
- normal game, quiz, lobby, analytics, diary, store, or profile screens behaving differently on mobile
- mobile-first fixes that must not break desktop

## Read first

Before editing, read:
- `../../AGENTS.md`
- `../../PROJECT_MAP.md`
- `../../FEATURE_LOG.md`
- `../../BUG_RULES.md`
- `../manager/AGENTS.md`
- `../ui-styling/AGENTS.md`

Coordinate with:
- `codexgame` for live normal-game room, answer input, wager, chat, scoring, ready/reveal flow, focus, and flicker stability
- `codexquiz` for Quick Fire Quiz timers, quiz answer UI, quiz ready/reveal screens, and quiz scoring UI
- `codexlobby` for create/join/resume/invite layout and lifecycle
- `codexanalytics` for analytics panels, end-game summaries, and question insights
- `codexstore` for diary, forfeits, profile, private notes, and store UI
- `codexdata` only when the mobile issue is caused by Firebase/listener/data shape behaviour

## Scope

You own:
- responsive CSS and layout rules
- mobile spacing, stacking, ordering, and panel sizing
- touch target sizing and reachable controls
- mobile host control panels
- mobile chat placement and internal scroll behaviour
- keyboard-safe input areas
- preventing clipped questions, buttons, score pills, headers, and nav controls
- reducing unnecessary mobile scrolling without hiding required content

You do not own:
- scoring rules
- wager result logic
- quiz timer scoring logic
- Firebase lifecycle or database schemas, unless coordinated with `codexdata`
- broad app rewrites

## Mobile principles

- Design for a real phone viewport first, then preserve desktop.
- Keep primary actions reachable without excessive scrolling.
- Do not hide required gameplay controls behind cramped headers.
- Prefer stacking and internal scroll regions over letting the whole page grow endlessly.
- Keep chat, answer inputs, and control buttons stable while typing.
- Avoid changes that steal focus from text boxes or remount answer forms.
- Use `svh`/`dvh` carefully for mobile viewport height where appropriate.
- Respect safe areas with `env(safe-area-inset-*)` when controls sit near screen edges.
- Avoid horizontal overflow at all mobile widths.
- Minimum practical touch target should be around 44px high unless the surrounding UI clearly supports smaller secondary controls.

## Required checks before finishing

For every mobile UI change, inspect affected screens at these conceptual widths:
- 360px phone
- 390px phone
- 430px large phone
- 768px tablet
- desktop width if the same CSS touches desktop

Check:
- no clipped text in question panels
- no hidden submit/ready/next controls
- no header overlap
- no horizontal page scroll
- chat/input stays usable with internal scroll where needed
- mobile keyboard does not make the main action unreachable where practical
- desktop layout is not degraded

## Implementation rules

- Prefer targeted class changes in `src/styles.css` or existing component-specific styles.
- Reuse existing design tokens/classes where possible.
- Keep changes small and local to the affected screen.
- Do not rename major classes unless necessary.
- Do not change business logic for a visual mobile issue.
- Do not add new dependencies for layout fixes.
- Do not introduce timers, random keys, or forced remounts to solve visual bugs.

## Completion report

When done, report:
- changed files
- affected screens
- mobile widths considered
- root cause
- build result
- risks/assumptions
- whether deployment is safe

Run `npm run build` before finishing any code change. Do not deploy unless explicitly told to deploy.
