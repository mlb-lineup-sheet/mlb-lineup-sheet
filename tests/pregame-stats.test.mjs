import assert from 'node:assert/strict';
import { pregameBattingStats } from '../scripts/lib/mlb-game.mjs';

const before = { atBats: 100, hits: 30, baseOnBalls: 10, hitByPitch: 2, sacFlies: 3, totalBases: 50, homeRuns: 4, rbi: 20 };
const game = { atBats: 4, hits: 2, baseOnBalls: 1, hitByPitch: 0, sacFlies: 0, totalBases: 5, homeRuns: 1, rbi: 3 };
const after = Object.fromEntries(Object.entries(before).map(([key, value]) => [key, value + game[key]]));
const expected = { avg: '.300', homeRuns: 4, rbi: 20, ops: '.865' };
assert.deepEqual(pregameBattingStats({ seasonStats: { batting: before } }), expected);
assert.deepEqual(pregameBattingStats({ seasonStats: { batting: after }, stats: { batting: game } }), expected);
assert.equal(pregameBattingStats({}), null);
const zero = Object.fromEntries(Object.keys(before).map(key => [key, 0]));
assert.deepEqual(pregameBattingStats({ seasonStats: { batting: zero } }), { avg: null, homeRuns: 0, rbi: 0, ops: null });
assert.deepEqual(pregameBattingStats({ seasonStats: { batting: game }, stats: { batting: game } }), { avg: null, homeRuns: 0, rbi: 0, ops: null });
assert.deepEqual(pregameBattingStats({ seasonStats: { batting: { homeRuns: 0, rbi: 0 } } }), { avg: null, homeRuns: 0, rbi: 0, ops: null });
assert.equal(pregameBattingStats({ seasonStats: { batting: { ...before, totalBases: 150 } } }).ops, '1.865');
console.log('PASS pregame batting: scheduled, live/final, debut, missing data, OPS above 1.000');
