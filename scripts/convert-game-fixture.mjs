import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveDisplayName } from './lib/player-dictionary.mjs';

const [fixturePath, dictionaryPath, outputPath] = process.argv.slice(2);
if (!outputPath) throw new Error('usage: node scripts/convert-game-fixture.mjs fixture dictionary output');
const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
const dictionary = JSON.parse(await fs.readFile(dictionaryPath, 'utf8')).players;
const convert = player => ({ ...player, conversion: resolveDisplayName(player, dictionary) });
const report = {
  gamePk: fixture.gamePk, gameDate: fixture.gameDate, away: fixture.away, home: fixture.home,
  actualStartingPitchers: { away: convert(fixture.actualStartingPitchers.away), home: convert(fixture.actualStartingPitchers.home) },
  startingLineups: { away: fixture.startingLineups.away.map(convert), home: fixture.startingLineups.home.map(convert) },
};
await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ gamePk: fixture.gamePk, outputPath }));
