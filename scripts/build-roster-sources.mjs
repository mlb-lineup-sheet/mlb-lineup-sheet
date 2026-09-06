import fs from 'node:fs/promises';
import { parseSpotvWorkbook } from './lib/spotv-xlsx.mjs';
import { MLB_TEAM_TO_SPOTV_SHEET } from './lib/mlb-team-map.mjs';
import { normalizeRosterName } from './lib/roster-match.mjs';

const [workbookPath, dictionaryPath = 'runtime/spotv-player-dictionary.json', outputPath = 'runtime/roster-sources.json'] = process.argv.slice(2);
if (!workbookPath) throw new Error('usage: node scripts/build-roster-sources.mjs READINGS.xlsx [dictionary.json] [output.json]');

const workbook = parseSpotvWorkbook(workbookPath);
const dictionary = JSON.parse(await fs.readFile(dictionaryPath, 'utf8')).players;
const idsByKey = new Map();
for (const player of Object.values(dictionary)) {
  const key = `${player.sourceTeam}:${normalizeRosterName(player.spotvOfficialName ?? player.officialName)}:${player.birthDate}`;
  if (!idsByKey.has(key)) idsByKey.set(key, []);
  idsByKey.get(key).push(Number(player.playerId));
}

const teamIdByCode = new Map(Object.entries(MLB_TEAM_TO_SPOTV_SHEET).map(([id, code]) => [code, Number(id)]));
const teams = {};
for (const sheet of workbook.sheets) {
  const teamId = teamIdByCode.get(sheet.team);
  if (!teamId) throw new Error(`teamId not found: ${sheet.team}`);
  const players = workbook.players.filter(player => player.sourceTeam === sheet.team).map(player => {
    const key = `${sheet.team}:${normalizeRosterName(player.officialName)}:${player.birthDate}`;
    const ids = idsByKey.get(key) ?? [];
    return {
      playerId: ids.length === 1 ? ids[0] : null,
      category: player.category,
      jerseyNumber: player.jerseyNumber,
      spotvName: player.spotvName,
      officialName: player.officialName,
      batsThrows: player.batsThrows,
      birthDate: player.birthDate,
      excelNote: player.note,
    };
  });
  teams[teamId] = { teamId, teamCode: sheet.team, teamName: sheet.teamName, venueName: sheet.venueName, manager: sheet.manager, players };
}

await fs.writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), teams }, null, 2)}\n`);
console.log(JSON.stringify({ teams: Object.keys(teams).length, players: Object.values(teams).reduce((sum, team) => sum + team.players.length, 0), unresolved: Object.values(teams).flatMap(team => team.players).filter(player => !player.playerId).length }));
