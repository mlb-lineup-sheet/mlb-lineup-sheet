import fs from 'node:fs/promises';
import { buildRoster, pregameStandingsDate } from './lib/mlb-roster.mjs';
import { normalizeRosterName } from './lib/roster-match.mjs';

const sourcePath = process.argv[2] ?? 'runtime/roster-sources.json';
const outputPath = process.argv[3] ?? '/tmp/spotv-roster-validation.json';
const sources = JSON.parse(await fs.readFile(sourcePath, 'utf8')).teams;
const officialDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const standingsDate = pregameStandingsDate(officialDate);
const season = Number(officialDate.slice(0, 4));

async function json(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'SPOTV-Lineup-Generator/1.0' } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

const standings = await json(`https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=${season}&standingsTypes=regularSeason&date=${standingsDate}&hydrate=team`);
const entries = Object.values(sources);
const results = [];
for (let offset = 0; offset < entries.length; offset += 5) {
  const batch = entries.slice(offset, offset + 5);
  results.push(...await Promise.all(batch.map(async source => {
    try {
      const hydrate = `person(stats(group=[hitting,pitching],type=byDateRange,startDate=${season}-01-01,endDate=${standingsDate},gameType=R))`;
      const activeUrl = new URL(`https://statsapi.mlb.com/api/v1/teams/${source.teamId}/roster`);
      activeUrl.searchParams.set('rosterType', 'active');
      activeUrl.searchParams.set('hydrate', hydrate);
      const [active, fortyMan, coaches, team] = await Promise.all([
        json(activeUrl),
        json(`https://statsapi.mlb.com/api/v1/teams/${source.teamId}/roster?rosterType=40Man`),
        json(`https://statsapi.mlb.com/api/v1/teams/${source.teamId}/coaches`),
        json(`https://statsapi.mlb.com/api/v1/teams/${source.teamId}?hydrate=venue,division`),
      ]);
      const view = buildRoster({ source, active, fortyMan, standings, coaches, team, fetchedAt: new Date().toISOString() });
      const apiManager = coaches.roster?.find(entry => entry.jobId === 'MNGR' || entry.job === 'Manager')?.person?.fullName ?? null;
      return {
        teamId: source.teamId, teamCode: source.teamCode, ok: true,
        sourcePlayers: source.players.length, active: active.roster?.length ?? 0, fortyMan: fortyMan.roster?.length ?? 0,
        activeWithStats: view.players.filter(player => player.status === 'ACTIVE' && player.stats).length,
        unresolved: view.unresolved,
        unmatchedActive: view.unmatchedActive,
        record: view.record, leagueName: view.leagueName, divisionName: view.divisionName,
        manager: { source: source.manager.officialName, api: apiManager, matched: normalizeRosterName(source.manager.officialName) === normalizeRosterName(apiManager) },
        venue: { source: source.venueName, api: view.officialVenueName, present: Boolean(source.venueName && view.officialVenueName) },
      };
    } catch (error) {
      return { teamId: source.teamId, teamCode: source.teamCode, ok: false, error: error.message };
    }
  })));
}

const report = { officialDate, standingsDate, teams: results };
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ teams: results.length, ok: results.filter(item => item.ok).length, failed: results.filter(item => !item.ok).length, unresolved: results.reduce((sum, item) => sum + (item.unresolved?.length ?? 0), 0), unmatchedActive: results.reduce((sum, item) => sum + (item.unmatchedActive?.length ?? 0), 0), managerMismatches: results.filter(item => item.ok && !item.manager.matched).length, outputPath }));
