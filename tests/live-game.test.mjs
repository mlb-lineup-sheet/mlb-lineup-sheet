import assert from 'node:assert/strict';
import { buildLiveView } from '../scripts/lib/mlb-live.mjs';
const fixture = {
  gamePk: 123, gameData: { status: { abstractGameState: 'Live', detailedState: 'In Progress' }, teams: { away: { id: 1, name: 'Away' }, home: { id: 2, name: 'Home' } }, players: { ID10: { id: 10, fullName: 'Batter' } } },
  liveData: { linescore: { currentInning: 10, isTopInning: true, inningState: 'Top', balls: 2, strikes: 1, outs: 0, offense: { second: { id: 20, fullName: 'Runner' } }, innings: [{ num: 10, away: { runs: 0 } }], teams: { away: { runs: 0, hits: 0, errors: 0 } } }, plays: { currentPlay: { about: { isComplete: false }, matchup: { batter: { id: 10 }, pitcher: { id: 30, fullName: 'Pitcher' } } }, allPlays: [
    { atBatIndex: 0, about: { isComplete: true, inning: 1, isTopInning: true }, result: { eventType: 'home_run', rbi: 1, awayScore: 1, homeScore: 0 } },
    { atBatIndex: 1, about: { isComplete: true, inning: 1, isTopInning: false }, result: { eventType: 'strikeout', awayScore: 1, homeScore: 0 } },
    { atBatIndex: 2, about: { isComplete: false } },
  ] } },
};
const game = buildLiveView(fixture, { playerName: p => `JP:${p.fullName}` });
assert.equal(game.matchup.batter.name, 'JP:Batter');
assert.equal(game.count.balls, 2);
assert.equal(game.bases[1].name, 'JP:Runner');
assert.equal(game.teams.away.runs, 0);
assert.equal(game.teams.home.runs, null);
assert.deepEqual(game.innings, [{ num: 10, away: 0, home: null }]);
assert.deepEqual(game.plays.map(p => p.index), [1, 0]);
assert.equal(game.plays[1].event, '本塁打');
for (const state of ['Middle', 'End']) {
  const copy = structuredClone(fixture); copy.liveData.linescore.inningState = state;
  assert.equal(buildLiveView(copy).matchup, null);
  assert.equal(buildLiveView(copy).count, null);
}
for (const status of [{ abstractGameState: 'Final' }, { abstractGameState: 'Preview' }, { abstractGameState: 'Live', detailedState: 'Delayed: Rain' }]) {
  const copy = structuredClone(fixture); copy.gameData.status = status;
  const result = buildLiveView(copy);
  assert.equal(result.matchup, null); assert.equal(result.count, null);
  assert.deepEqual(result.bases, [null, null, null]);
}
assert.deepEqual(buildLiveView({}).plays, []);
console.log('PASS live: names, counts, runners, extra innings, missing vs zero scores, play order, pregame/final/delay/between innings');
const { pitchView } = await import('../scripts/lib/mlb-live.mjs');
const pitches = pitchView({ playEvents: [
  { isPitch: false, pitchData: { startSpeed: 90 } },
  { isPitch: true, pitchNumber: 1, details: { type: { code: 'FC' }, call: { code: 'C' }, isStrike: true }, pitchData: { startSpeed: 94, coordinates: { pX: 0, pZ: 2 }, strikeZoneTop: 3.3, strikeZoneBottom: 1.6 } },
  { isPitch: true, pitchNumber: 2, details: { isBall: true } },
] });
assert.equal(pitches.length, 2);
assert.equal(pitches[0].x, 0);
assert.equal(pitches[0].kmh, 151.3);
assert.equal(pitches[0].type, 'カッター');
assert.equal(pitches[0].kind, 'strike');
assert.equal(pitches[1].x, null);
assert.equal(pitches[1].speed, null);
assert.equal(pitches[1].kind, 'ball');
assert.equal(buildLiveView(fixture).currentAtBat.batter.id, 10);
console.log('PASS pitch coordinates, zero location, mph conversion, missing location, non-pitch exclusion');
const rosterFixture = structuredClone(fixture);
rosterFixture.gameData.players.ID11 = { id: 11, fullName: 'Replacement' };
rosterFixture.gameData.players.ID30 = { id: 30, fullName: 'Starter' };
rosterFixture.gameData.players.ID31 = { id: 31, fullName: 'Reliever' };
rosterFixture.liveData.boxscore = { teams: { away: {
  battingOrder: [11], pitchers: [30,31], players: {
    ID10: { person: {id:10}, position:{abbreviation:'SS'} },
    ID11: { person:{id:11}, position:{abbreviation:'PH'}, seasonStats:{batting:{avg:'.250'}} },
    ID30: { person:{id:30}, position:{abbreviation:'P'} },
    ID31: { person:{id:31}, position:{abbreviation:'P'}, seasonStats:{pitching:{era:'2.50'}} },
  },
} } };
rosterFixture.liveData.plays.allPlays[0].playEvents = [
  {index:0,details:{eventType:'offensive_substitution'},player:{id:11},replacedPlayer:{id:10},position:{abbreviation:'PH'}},
  {index:1,details:{eventType:'defensive_switch'},player:{id:11},position:{abbreviation:'SS'}},
  {index:2,details:{eventType:'pitching_substitution'},player:{id:31},position:{abbreviation:'P'}},
];
rosterFixture.liveData.linescore.defense={shortstop:{id:11},pitcher:{id:31},team:{id:1}};
const rosterGame=buildLiveView(rosterFixture);
assert.equal(rosterGame.members.away.lineup[0].id,11);
assert.equal(rosterGame.members.away.lineup[0].position,'遊');
assert.equal(rosterGame.members.away.lineup[0].stats.avg,'.250');
assert.equal(rosterGame.members.away.pitcher.id,31);
assert.equal(rosterGame.substitutions.away[0].outgoing.id,10);
assert.equal(rosterGame.substitutions.away[2].outgoing.id,30);
assert.equal(rosterGame.defense.find(p=>p.key==='shortstop').player.name,'Replacement');
console.log('PASS current lineup, position switch, season stats, pitcher replacement, field names');

const { battingResult } = await import('../scripts/lib/mlb-live.mjs');
for (const [type, location, trajectory, expected] of [
  ['field_out','6','ground_ball','遊ゴ'], ['double','7','fly_ball','左二'],
  ['home_run','9','fly_ball','右本'], ['home_run','89','fly_ball','右中本'], ['double','78','line_drive','左中二'], ['field_out','8','line_drive','中直'],
  ['walk',undefined,undefined,'四球'], ['home_run',undefined,undefined,'本'],
]) assert.equal(battingResult({result:{eventType:type},playEvents:[{hitData:{location,trajectory}}]}), expected);
const todayFixture = structuredClone(rosterFixture);
todayFixture.liveData.plays.allPlays[0].matchup = {batter:{id:11}};
const today = buildLiveView(todayFixture).members.away.lineup[0].today;
assert.deepEqual(today, [{label:'本',isOut:false,isHit:true,rbi:1,inning:1}]);
console.log('PASS batting result abbreviations, missing direction, player attribution and RBI');
