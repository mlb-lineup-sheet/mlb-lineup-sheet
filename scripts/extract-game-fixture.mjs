import fs from 'node:fs/promises';
import path from 'node:path';
import { buildGameFixture, findScheduledGame } from './lib/mlb-game.mjs';

const [schedulePath, livePath, boxPath, gamePkArg, outputPath] = process.argv.slice(2);
if (!outputPath) throw new Error('usage: extract-game-fixture schedule live box gamePk output');
const [schedule, live, box] = await Promise.all(
  [schedulePath, livePath, boxPath].map(async p => JSON.parse(await fs.readFile(p, 'utf8')))
);
const gamePk = Number(gamePkArg);
const scheduledGame = findScheduledGame(schedule, gamePk, live);
if (!scheduledGame) throw new Error(`gamePk ${gamePk} not found in schedule`);
const fixture = {
  ...buildGameFixture({ scheduledGame, live, box }),
  rawSourceInfo: {
    schedule: 'https://statsapi.mlb.com/api/v1/schedule',
    liveFeed: `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`,
    boxscore: `https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`,
    extractionRule: 'Initial hitters are player records whose battingOrder is exactly 100,200,...,900; current battingOrder arrays are not used after substitutions.',
  },
};
if (fixture.lineupStatus !== 'available') throw new Error(`gamePk ${gamePk}: initial lineup incomplete`);
await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(fixture, null, 2) + '\n');
console.log(JSON.stringify({ gamePk, away: fixture.away.name, home: fixture.home.name, outputPath }));
