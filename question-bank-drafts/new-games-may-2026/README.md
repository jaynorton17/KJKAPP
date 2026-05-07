# New Game Question Bank Drafts

These CSV files are draft question-bank imports for the three new KJK game modes.

## Files And Sheet Names

- `Red Flag Green Flag.csv` -> Google Sheet tab: `Red Flag Green Flag`
- `Compatibility.csv` -> Google Sheet tab: `Compatibility`
- `Memory Lane.csv` -> Google Sheet tab: `Memory Lane`

Each file contains 300 rows plus the header row. They use the importer fields supported by `src/utils/importers.js`.

## Import Notes

- Copy each CSV into the matching sheet tab, preserving the header row.
- Keep `active` as `TRUE` for rows that should be imported.
- After copying, use the app's Question Bank control panel and run `Sync All Games`.
- Memory Lane already generates some past-answer recall prompts from previous game history. The Memory Lane CSV focuses on new memory prompts rather than generated recall rows.

## Validation Used

The files were validated with `parseGoogleSheetModeImport` and returned:

- Red Flag Green Flag: 300 imported, 0 invalid
- Compatibility: 300 imported, 0 invalid
- Memory Lane: 300 imported, 0 invalid

