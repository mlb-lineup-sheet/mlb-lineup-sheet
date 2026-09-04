import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { LINEUP_WRITE_ALLOWLIST } from '../scripts/lib/template-lineup-input.mjs';
import { formulaMap, readCellValues, sharedStringsFromXlsx, unzipEntry } from '../scripts/lib/ooxml-xlsx.mjs';

const templatePath = '/Users/hiramotoakihiro/Desktop/0602_PIT@SD_スタメン表.xlsx';
const spotvPath = '/Users/hiramotoakihiro/Desktop/SPOTV読み表.xlsx';
const outputPath = 'outputs/integrated-lineup-test/20250602_PIT@SD_スタメン表.xlsx';
const manifestPath = 'outputs/integrated-lineup-test/20250602_PIT@SD_スタメン表.manifest.json';
const fixture = JSON.parse(await fs.readFile('tests/fixtures/2025-06-01-pit-sd.json', 'utf8'));
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const dictionary = JSON.parse(await fs.readFile('private/dictionaries/spotv-player-dictionary.json', 'utf8')).players;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const templateHash = sha256(await fs.readFile(templatePath));
const spotvHash = sha256(await fs.readFile(spotvPath));
assert.equal(templateHash, '1dbe254ae0c2f70553b62229654e7962e6afecdfb824cf169ecc108a2e72b2e8');
assert.equal(spotvHash, '8d564890f3c3936fef588ecc7ef0c36e57738f02f5394d5432bcb11ac5dd10b3');
assert.equal(manifest.templateDate, ' 6/1 5:10pm  ET.');
assert.equal(manifest.japanDate, '20250602');
assert.equal(manifest.venueName, 'ペトコ・パーク');
assert.equal(manifest.awayTeamName, 'ピッツバーグ・パイレーツ');
assert.equal(manifest.homeTeamName, 'サンディエゴ・パドレス');
assert.equal(manifest.pitchers.away.playerId, fixture.probablePitchers.away.playerId);
assert.equal(manifest.pitchers.home.playerId, fixture.probablePitchers.home.playerId);
assert.equal(manifest.pitchers.away.playerId, fixture.actualStartingPitchers.away.playerId);
assert.equal(manifest.pitchers.home.playerId, fixture.actualStartingPitchers.home.playerId);
for (const side of ['away', 'home']) {
  assert.equal(manifest.lineups[side].length, 9);
  manifest.lineups[side].forEach((player, index) => {
    const expected = fixture.startingLineups[side][index];
    assert.equal(player.playerId, expected.playerId);
    assert.equal(player.sourceBattingOrderCode, String((index + 1) * 100));
    assert.equal(player.position.abbreviation, expected.position.abbreviation);
    assert.equal(player.jerseyNumber, expected.jerseyNumber);
    const dict = dictionary[String(player.playerId)];
    assert.equal(player.conversion.displayName, dict?.spotvName ?? player.fullName);
    assert.equal(player.conversion.spotvFound, Boolean(dict));
  });
}
const sheet = unzipEntry(outputPath, 'xl/worksheets/sheet1.xml');
const formulas = formulaMap(sheet);
assert.equal(formulas.size, 36);
assert.ok([...LINEUP_WRITE_ALLOWLIST].every(cell => !formulas.has(cell)));
const values = readCellValues(sheet, sharedStringsFromXlsx(outputPath));
for (const [ref, expected] of Object.entries(manifest.inputValues)) assert.equal(String(values.get(ref) ?? ''), String(expected ?? ''), ref);
for (let index = 0; index < 9; index++) {
  const row = index + 6;
  for (const [side, copyColumn] of [['away', 'O'], ['home', 'P']]) {
    const player = fixture.startingLineups[side][index];
    const text = values.get(`${copyColumn}${row}`);
    assert.equal(text.endsWith(`(${player.batSide.code}) ${player.position.abbreviation}`), true);
  }
}
assert.equal(sha256(await fs.readFile(templatePath)), templateHash, 'template source changed');
assert.equal(sha256(await fs.readFile(spotvPath)), spotvHash, 'SPOTV source changed');
console.log('PASS integrated PIT@SD lineup: 2 pitchers + 18 initial hitters, 64-cell allowlist, sources unchanged');
