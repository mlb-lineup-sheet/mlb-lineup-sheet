import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizeName } from '../scripts/lib/name-normalization.mjs';
import { buildDictionary, mergeMlbPeople, resolveDisplayName } from '../scripts/lib/player-dictionary.mjs';
import { parseSpotvWorkbook } from '../scripts/lib/spotv-xlsx.mjs';
import { buildGameFixture, gamesOnJstDate, jstDateString, scheduleQueryDates } from '../scripts/lib/mlb-game.mjs';

const exec = promisify(execFile);
const spotvPath = process.env.SPOTV_READINGS_PATH ?? '/Users/hiramotoakihiro/Desktop/SPOTV読み表.xlsx';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const beforeHash = hash(await fs.readFile(spotvPath));
const parsed = parseSpotvWorkbook(spotvPath);
assert.equal(parsed.sheetCount, 30);
assert.equal(parsed.players.length, 1385);

const cacheFiles = (await fs.readdir('private/cache/mlb')).filter(x => /^players-\d{4}\.json$/.test(x)).sort();
const payloads = await Promise.all(cacheFiles.map(async file => {
  const data = JSON.parse(await fs.readFile(`private/cache/mlb/${file}`, 'utf8'));
  data.season ??= Number(file.match(/\d{4}/)[0]);
  return data;
}));
const people = mergeMlbPeople(payloads);
const first = buildDictionary(parsed.players, people, {});
const second = buildDictionary(parsed.players, people, {});
assert.deepEqual(first, second, 'dictionary must be reproducible from the same source/cache');

assert.equal(normalizeName(' José  Fermín Jr. '), 'jose fermin jr');
assert.equal(normalizeName("Ke'Bryan-Hayes"), 'kebryan hayes');
const expectedSameNames = new Map([
  ['Max Muncy|1990-08-25', 571970], ['Max Muncy|2002-08-25', 691777],
  ['Jose Fermin|1999-03-29', 665877], ['Jose Fermin|2001-11-28', 820862],
]);
for (const [key, expectedId] of expectedSameNames) {
  const [name, birthDate] = key.split('|');
  const row = parsed.players.find(x => x.officialName === name && x.birthDate === birthDate);
  assert.ok(row, `SPOTV duplicate row missing: ${key}`);
  const entry = Object.values(first.dictionary).find(x => x.spotvOfficialName === name && x.birthDate === birthDate);
  assert.equal(entry?.playerId, expectedId, `same-name player must be separated by birthDate: ${key}`);
}

const known = resolveDisplayName({ playerId: 665833, fullName: 'Oneil Cruz' }, first.dictionary);
assert.equal(known.displayName, 'オニール・クルーズ');
assert.equal(known.spotvFound, true);
const missing = resolveDisplayName({ playerId: 999999999, fullName: 'Official MLB Name' }, first.dictionary);
assert.deepEqual(missing, { playerId: 999999999, officialName: 'Official MLB Name', displayName: 'Official MLB Name', spotvFound: false, spotvName: null, matchMethod: null, status: 'fallback', fallbackReason: 'spotv-not-found' });

const unsafe = buildDictionary([{ sourceTeam: 'X', sourceRow: 1, officialName: 'Different Spelling', spotvName: '使用禁止', birthDate: '2000-01-01', jerseyNumber: null }], people, {});
assert.equal(Object.keys(unsafe.dictionary).length, 0);
assert.equal(unsafe.unresolved[0].reason, 'official-name-not-found');

const manualOnly = buildDictionary(
  [{ sourceTeam: 'X', sourceRow: 1, officialName: 'Long Form', spotvName: '確認済み表記', birthDate: '2000-01-01', jerseyNumber: null }],
  [],
  { confirmed: { spotvOfficialName: 'Long Form', spotvName: '確認済み表記', birthDate: '2000-01-01', playerId: 123, mlbOfficialName: 'Short Form' } },
);
assert.equal(manualOnly.dictionary['123'].spotvName, '確認済み表記');
assert.equal(manualOnly.dictionary['123'].status, 'manual-confirmed');

for (const fixturePath of ['tests/fixtures/2025-06-01-pit-sd.json', 'tests/fixtures/2025-06-19-stl-cws-g2.json']) {
  const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
  const players = [fixture.actualStartingPitchers.away, fixture.actualStartingPitchers.home, ...fixture.startingLineups.away, ...fixture.startingLineups.home];
  assert.equal(players.length, 20);
  assert.equal(new Set(players.map(x => x.playerId)).size, 20);
  const conversions = players.map(x => resolveDisplayName(x, first.dictionary));
  assert.equal(conversions.length, 20);
  assert.ok(conversions.every(x => x.displayName && (x.spotvFound || x.fallbackReason === 'spotv-not-found')));
}

const sourceFiles = (await exec('rg', ['--files', 'scripts'])).stdout.trim().split('\n');
for (const file of sourceFiles) {
  const text = await fs.readFile(file, 'utf8');
  assert.equal(/NHK.{0,40}(fallback|フォールバック)/i.test(text), false, `NHK fallback must not exist: ${file}`);
}
assert.equal(hash(await fs.readFile(spotvPath)), beforeHash, 'source SPOTV workbook must remain byte-identical');

assert.equal(jstDateString(new Date('2026-09-03T15:00:00Z')), '2026-09-04');
assert.deepEqual(scheduleQueryDates('2026-09-04'), { startDate: '2026-09-03', endDate: '2026-09-04' });
const boundarySchedule = { dates: [{ games: [
  { gamePk: 1, gameDate: '2026-09-03T14:59:59Z' },
  { gamePk: 2, gameDate: '2026-09-03T15:00:00Z' },
  { gamePk: 3, gameDate: '2026-09-04T14:59:59Z' },
  { gamePk: 4, gameDate: '2026-09-04T15:00:00Z' },
] }] };
assert.deepEqual(gamesOnJstDate(boundarySchedule, '2026-09-04').map(game => game.gamePk), [2, 3]);

const [live823907, box823907, schedule823907] = await Promise.all(['live', 'boxscore', 'schedule'].map(async name =>
  JSON.parse(await fs.readFile(`private/cache/games/823907/${name}.json`, 'utf8'))
));
const scheduled823907 = schedule823907.dates.flatMap(date => date.games).find(game => game.gamePk === 823907);
const liveFixture = buildGameFixture({ scheduledGame: scheduled823907, live: live823907, box: box823907 });
assert.equal(liveFixture.lineupStatus, 'available');
for (const side of ['away', 'home']) {
  assert.deepEqual(liveFixture.startingLineups[side].map(player => player.sourceBattingOrderCode), ['100','200','300','400','500','600','700','800','900']);
}
assert.equal(liveFixture.startingLineups.away.find(player => player.playerId === 699024).position.abbreviation, '1B');
assert.equal(liveFixture.startingLineups.home.find(player => player.playerId === 571771).position.abbreviation, '3B');
const completedBox = structuredClone(box823907);
completedBox.teams.away.players.ID699024.position = { code: '2', name: 'Catcher', type: 'Catcher', abbreviation: 'C' };
completedBox.teams.away.players.ID699024.allPositions = [
  { code: '3', name: 'First Base', type: 'Infielder', abbreviation: '1B' },
  { code: '2', name: 'Catcher', type: 'Catcher', abbreviation: 'C' },
];
completedBox.teams.home.players.ID571771.position = { code: '8', name: 'Outfielder', type: 'Outfielder', abbreviation: 'CF' };
completedBox.teams.home.players.ID571771.allPositions = [
  { code: '5', name: 'Third Base', type: 'Infielder', abbreviation: '3B' },
  { code: '8', name: 'Outfielder', type: 'Outfielder', abbreviation: 'CF' },
];
const completedFixture = buildGameFixture({ scheduledGame: scheduled823907, live: live823907, box: completedBox });
assert.equal(completedFixture.startingLineups.away.find(player => player.playerId === 699024).position.abbreviation, '1B');
assert.equal(completedFixture.startingLineups.home.find(player => player.playerId === 571771).position.abbreviation, '3B');
const incompleteBox = structuredClone(box823907);
const firstAway = Object.values(incompleteBox.teams.away.players).find(player => player.battingOrder === '100');
firstAway.battingOrder = '101';
const incompleteFixture = buildGameFixture({ scheduledGame: scheduled823907, live: live823907, box: incompleteBox });
assert.equal(incompleteFixture.lineupStatus, 'incomplete');
assert.deepEqual(incompleteFixture.startingLineups.away, []);

const publicApp = await fs.readFile('public/app.js', 'utf8');
assert.equal(publicApp.includes('demoGames'), false);
assert.equal(publicApp.includes('demoLineups'), false);
assert.match(publicApp, /history\.pushState/);
assert.match(publicApp, /popstate/);
console.log(`PASS ${parsed.players.length} SPOTV rows, ${Object.keys(first.dictionary).length} resolved, ${first.unresolved.length} unresolved, two 20-player fixtures`);
