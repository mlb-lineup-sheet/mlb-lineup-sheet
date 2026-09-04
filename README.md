# MLB official lineup acquisition validation

This folder contains only the acquisition-phase validation for SPOTV LINEUP GENERATOR.

## Confirmed rules

- `schedule` supplies game identity, date/time, venue, teams, status, doubleheader metadata, and probable pitchers.
- `live feed` supplies authoritative player identity plus `batSide` and `pitchHand`.
- `boxscore` supplies jersey number, game position, batting-order records, and pitching `gamesStarted`.
- The actual starting pitcher is the unique player whose game pitching stats have `gamesStarted === 1`.
- The initial lineup is reconstructed from player records whose `battingOrder` is exactly `100, 200, ... 900`.
- Do not use the final `teams.*.battingOrder` array for a completed game. It can contain substitutes.
- A lineup is treated as announced only when both teams have exactly one player for every initial slot `100` through `900`. Game status alone is not sufficient.
- Missing jersey numbers remain `null`; no inference or external-site fallback is allowed.

## Date correction for the reference workbook

There is no PIT at SD game on 2026-06-02. The workbook displays `6/1 5:10pm ET`, which matches gamePk 777681 on 2025-06-01 at Petco Park (2025-06-02 in Japan).

## Additional case

GamePk 777458, STL at CWS on 2025-06-19, was selected because it is doubleheader Game 2. The schedule contains both a postponed record and the rescheduled final record for the same gamePk, so extraction selects the schedule occurrence whose `gameDate` matches the live feed.

## SPOTV playerId dictionary phase

This phase safely converts MLB `playerId` values to names taken verbatim from the private SPOTV workbook.

- The source workbook is read without being modified. Thirty team sheets are discovered from workbook metadata; player rows are detected below each sheet's player-table header.
- English names are Unicode-normalized, accents and punctuation are normalized, and whitespace is collapsed. Suffix tokens such as `Jr`, `Sr`, `II`, and `III` remain part of the name.
- Automatic confirmation requires the normalized English name **and** birth date to identify exactly one MLB official record. Team and jersey are retained for review but never establish identity.
- MLB candidates are cached from the official bulk season-player endpoint. Multiple seasons are merged by `playerId`, covering current players, recent IL players, and recent transfers without one request per SPOTV row.
- A missing, ambiguous, or birth-date-conflicting match remains `unresolved`. No nickname guessing or approximate spelling match is performed.
- Runtime lookup uses `playerId` as its key. A missing key returns the MLB official English name with `fallbackReason: "spotv-not-found"`.
- Human-reviewed exceptions can be added to `private/dictionaries/manual-player-overrides.json`; the example schema is committed while private values remain ignored.
- Regeneration also emits a structured diff for additions, removals, SPOTV-name changes, team changes, jersey changes, and resolved/unresolved transitions.

Private input, caches, dictionaries, reports, and generated outputs are excluded by `.gitignore`. This phase still does not write a real lineup into Excel, implement UI/server/printing, initialize Git, commit, or push.

## Integrated gamePk-to-Excel phase

For a saved MLB official fixture, the generator now connects initial-lineup extraction, SPOTV playerId conversion, and allowlisted OOXML editing:

```text
node scripts/generate-lineup-xlsx.mjs --game-pk 777681 --template /path/to/template.xlsx --spotv /path/to/SPOTV読み表.xlsx
```

The workbook is copied into `outputs/integrated-lineup-test/`. Only 64 declared input cells in `xl/worksheets/sheet1.xml` may be targeted; an attempt to write another cell or any formula cell fails. The generator uses US Eastern time inside the workbook and the Japan date in the output filename. It also supports `_G1`/`_G2` filename suffixes.

`scripts/validate-generated-lineup.mjs` compares the generated ZIP package with the original and verifies formula count/content, all untargeted cells, drawings, images, styles, print settings, and direct input values. See `docs/excel-input-map.md` for the complete mapping and downstream reference structure.

## Local production UI

The localhost server exposes only `public/index.html`, `public/styles.css`, `public/app.js`, and authenticated `/api/*` routes. Files below `private/` and the source Excel files are never served directly.

Set the password at runtime and start the server:

```text
SPOTV_LINEUP_PASSWORD='set-on-the-SPOTV-PC' npm start
```

Optional environment variables:

```text
PORT=4173
HOST=127.0.0.1
SPOTV_TEMPLATE_PATH=/path/to/template.xlsx
SPOTV_READINGS_PATH=/path/to/SPOTV読み表.xlsx
```

Authentication uses a server-side, in-memory session with an `HttpOnly`, `SameSite=Strict` cookie. The password is not stored in frontend code or project files. Sessions and download tokens expire and reset when the local server restarts.

The games screen queries the official MLB schedule for the two MLB calendar dates that can overlap the selected JST day, then filters each `gameDate` instant into the exact JST midnight-to-midnight interval. Lineup routes use `#games` and `#lineup/{gamePk}` and are restored only after the server confirms the session.

### Commands

Use the bundled or local Node.js executable:

```text
node scripts/fetch-mlb-player-pool.mjs private/cache/mlb 2024 2025 2026
node scripts/build-player-dictionary.mjs --spotv /path/to/SPOTV読み表.xlsx
node scripts/convert-game-fixture.mjs tests/fixtures/2025-06-01-pit-sd.json private/dictionaries/spotv-player-dictionary.json private/reports/2025-06-01-pit-sd-conversion.json
SPOTV_READINGS_PATH=/path/to/SPOTV読み表.xlsx node tests/run-tests.mjs
```
