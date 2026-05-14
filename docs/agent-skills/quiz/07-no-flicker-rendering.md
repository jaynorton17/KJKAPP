# No-Flicker Rendering Skill

Use this when fixing blinking, remounting, input focus loss, answer disappearance, or unstable realtime UI updates.

Rules:
- Do not remount the question component unnecessarily.
- Do not use changing keys on major containers unless required.
- Keep local draft answer state separate from Firebase submitted answer state.
- Do not update local input value from Firebase after the user starts typing.
- Avoid Firebase writes on every keystroke.
- Avoid state updates inside effects that trigger the same effect again.
- Keep component identity stable between realtime updates.
- Reveal animation must not remount the whole screen.
- Flashing green/red should be CSS/state on stable cards, then settle to final state.
