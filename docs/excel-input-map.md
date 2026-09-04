# Excel input map

The production generator edits only `xl/worksheets/sheet1.xml` (`スタメン`). All formula cells and every other OOXML part remain unchanged.

## Direct input cells

| Cells | Meaning | Source |
|---|---|---|
| `B1` | Game date/time displayed in the workbook | `gameDate`, converted to `America/New_York` |
| `B2` | Ballpark | Home-team venue text from the SPOTV workbook header |
| `B3`, `H3` | Away/home team names | Team names from the SPOTV workbook headers |
| `D4:E4:F4` | Away starter jersey, display name, throwing hand | MLB probable starter; SPOTV playerId lookup for the name |
| `J4:K4:L4` | Home starter jersey, display name, throwing hand | MLB probable starter; SPOTV playerId lookup for the name |
| `D6:E14` | Away lineup jersey and display name | MLB initial lineup slots `100..900`; SPOTV playerId lookup |
| `J6:K14` | Home lineup jersey and display name | MLB initial lineup slots `100..900`; SPOTV playerId lookup |
| `O6:O14`, `P6:P14` | Away/home copy-field source text | MLB official name, `batSide.code`, and `position.abbreviation` |

This is an explicit 64-cell allowlist. `D4` and `J4` can remain byte-identical when the source template already has the same jersey values, so an actual run may show only 62 changed cell nodes.

## Formula cells that must not be edited

`C6:C14`, `F6:F14`, `I6:I14`, and `L6:L14` are 36 formula cells. They extract position and batting side from `O6:O14` and `P6:P14`. Some are shared-formula followers with empty `<f>` text; they are still formula cells and are never direct write targets.

The NYM/BOS sample content formerly stored in `O6:P14` is replaced in full. Existing formulas then expose the new MLB position and batting-side codes in the visible lineup.

## Downstream references

The untouched sheets contain the following direct formula references to `スタメン`:

- `守備`: 43
- `表`: 61
- `裏`: 61
- `スタメン制作CG分`: 82

The `date` sheet is a static business-name/position lookup sheet plus two unrelated conversion formulas.

## Date and filename rules

- Workbook display: US Eastern time (`America/New_York`), preserving the existing `M/D h:mmam/pm ET.` convention.
- Output filename: Japan date (`Asia/Tokyo`) in `YYYYMMDD_AWAY@HOME_スタメン表.xlsx` form.
- Doubleheaders append `_G1` or `_G2` before `_スタメン表.xlsx`.

## Existing formula observation

Two formulas in `守備` (`N14` and `M15`) contain one `MATCH` range using `I4:I51` while their surrounding checks and final lookup use `I4:I14`. Rows below 14 are empty in the current template, so this does not affect the generated PIT/SD result. The generator preserves these formulas exactly rather than silently correcting the template.
