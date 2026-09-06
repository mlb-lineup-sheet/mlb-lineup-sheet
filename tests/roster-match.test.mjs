import assert from 'node:assert/strict';
import { classifyRosterStatus, matchRosterPlayer, normalizeRosterName } from '../scripts/lib/roster-match.mjs';
import { activePlayerStats, pregameStandingsDate, rosterStatsDate } from '../scripts/lib/mlb-roster.mjs';

assert.equal(pregameStandingsDate('2026-09-06'), '2026-09-05');
assert.equal(pregameStandingsDate('2026-03-01'), '2026-02-28');
assert.equal(pregameStandingsDate('2026-01-01'), '2025-12-31');
assert.equal(rosterStatsDate('2026-09-06', 'N', 1), '2026-09-05');
assert.equal(rosterStatsDate('2026-09-06', 'Y', 1), '2026-09-05');
assert.equal(rosterStatsDate('2026-09-06', 'Y', 2), '2026-09-06');
const stats = activePlayerStats([{ person: { id: 1, stats: [{ group: { displayName: 'pitching' }, splits: [
  { team: { id: 116 }, sport: { id: 1 }, stat: { gamesPitched: 2 } },
  { sport: { id: 0 }, stat: { gamesPitched: 7 } },
] }] }, position: { type: 'Pitcher' } }]);
assert.equal(stats.get(1).gamesPitched, 7);

assert.equal(normalizeRosterName('Yilber Díaz'), normalizeRosterName('Yilber Diaz'));
assert.equal(normalizeRosterName('Javier Báez'), normalizeRosterName('Javier Baez'));
assert.equal(normalizeRosterName('Wenceel Pérez'), normalizeRosterName('Wenceel Perez'));

const entry = {
  person: { id: 700270, fullName: 'Yilber Díaz', birthDate: '2000-08-19' },
  status: { code: 'A', description: 'Active' },
};
assert.equal(matchRosterPlayer({ officialName: 'Yilber Diaz', birthDate: '2000-08-19' }, [entry]).entry.person.id, 700270);
assert.equal(classifyRosterStatus(1, new Set([1]), null), 'ACTIVE');
assert.equal(classifyRosterStatus(2, new Set(), { status: { code: 'D60' } }), 'IL');
assert.equal(classifyRosterStatus(3, new Set(), { status: { code: 'RM' } }), 'MINOR');
assert.equal(classifyRosterStatus(4, new Set(), { status: { code: 'TI' } }), 'OTHER');
assert.equal(classifyRosterStatus(5, new Set(), { status: { code: 'X' } }), '40-MAN');
assert.equal(classifyRosterStatus(6, new Set(), null), 'MINOR');

console.log('roster match tests passed');
