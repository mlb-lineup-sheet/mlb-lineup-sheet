import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { MLB_TEAM_TO_SPOTV_SHEET } from '../scripts/lib/mlb-team-map.mjs';

const payload = JSON.parse(await fs.readFile(new URL('../runtime/roster-sources.json', import.meta.url), 'utf8'));
const teams = Object.values(payload.teams);
assert.equal(teams.length, 30);
assert.deepEqual(teams.map(team => team.teamCode).sort(), Object.values(MLB_TEAM_TO_SPOTV_SHEET).sort());
assert.equal(new Set(teams.map(team => team.teamId)).size, 30);
assert.equal(teams.reduce((sum, team) => sum + team.players.length, 0), 1385);
assert.equal(teams.flatMap(team => team.players).filter(player => !player.category).length, 0);
assert.equal(teams.filter(team => !team.manager?.spotvName || !team.manager?.officialName).length, 0);
assert.equal(teams.filter(team => !team.teamName || !team.venueName).length, 0);

console.log('roster source tests passed');
