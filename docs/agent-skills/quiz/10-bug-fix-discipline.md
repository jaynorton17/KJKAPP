# Bug Fix Discipline Skill

Use this for every coding agent before any specialist skill.

Rules:
- Read relevant files before editing.
- Do not guess file names.
- Do not redesign unrelated UI.
- Do not change unrelated features.
- Make the smallest safe change.
- Preserve existing working behaviour.
- Explain why each changed file was touched.
- Do not introduce new libraries unless necessary.
- Do not remove code unless you know what depends on it.
- Prefer fixing root cause over hiding symptoms.

Before editing:
- Identify the bug/target behaviour.
- Identify likely files.
- Inspect current implementation.
- Explain the intended fix briefly.

After editing:
- Run build/test if available.
- Summarise exact changes.
- Mention untested areas honestly.
