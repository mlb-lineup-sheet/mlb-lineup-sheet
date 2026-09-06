import { mergeRosterStatus, normalizeRosterName } from './roster-match.mjs';

export function pregameStandingsDate(officialDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(officialDate ?? '')) throw new Error('現地日付が不正です');
  const date = new Date(`${officialDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function rosterStatsDate(officialDate, doubleHeader, gameNumber) {
  return doubleHeader === 'Y' && Number(gameNumber) === 2
    ? officialDate
    : pregameStandingsDate(officialDate);
}

function aggregateStat(person, group) {
  const stats = person?.stats?.find(item => item.group?.displayName === group);
  const split = stats?.splits?.find(item => !item.team)
    ?? stats?.splits?.find(item => item.sport?.id === 1)
    ?? stats?.splits?.[0];
  return split?.stat ?? null;
}

export function activePlayerStats(activeRoster = []) {
  return new Map(activeRoster.map(entry => {
    const person = entry.person ?? {};
    const group = entry.position?.type === 'Pitcher' ? 'pitching' : 'hitting';
    return [Number(person.id), aggregateStat(person, group)];
  }));
}

const DIVISIONS = Object.freeze({
  200: ['アメリカン・リーグ', '西地区'],
  201: ['アメリカン・リーグ', '東地区'],
  202: ['アメリカン・リーグ', '中地区'],
  203: ['ナショナル・リーグ', '西地区'],
  204: ['ナショナル・リーグ', '東地区'],
  205: ['ナショナル・リーグ', '中地区'],
});

function teamRecord(standings, teamId) {
  for (const record of standings.records ?? []) {
    const team = record.teamRecords?.find(item => item.team?.id === Number(teamId));
    if (team) return {
      wins: team.wins,
      losses: team.losses,
      divisionRank: Number(team.divisionRank),
      lastUpdated: team.lastUpdated ?? record.lastUpdated ?? null,
    };
  }
  throw new Error(`${teamId}の順位情報を取得できませんでした`);
}

function selectedTeam(teamPayload, teamId) {
  const team = teamPayload.teams?.find(item => item.id === Number(teamId));
  if (!team) throw new Error(`${teamId}の球団情報を取得できませんでした`);
  return team;
}

function managerView(source, coaches) {
  const manager = coaches.roster?.find(entry => entry.jobId === 'MNGR' || entry.job === 'Manager');
  const officialName = manager?.person?.fullName ?? source.manager.officialName;
  const matchesSource = normalizeRosterName(officialName) === normalizeRosterName(source.manager.officialName);
  return {
    playerId: manager?.person?.id ?? source.manager.playerId ?? null,
    officialName,
    displayName: matchesSource ? source.manager.spotvName : officialName,
  };
}

export function buildRoster({ source, active, fortyMan, standings, coaches, team, fetchedAt }) {
  const merged = mergeRosterStatus(source.players, active.roster, fortyMan.roster);
  const counts = { ACTIVE: 0, IL: 0, MINOR: 0, '40-MAN': 0, OTHER: 0 };
  for (const player of merged.players) counts[player.status] += 1;
  const teamData = selectedTeam(team, source.teamId);
  const [leagueName, divisionName] = DIVISIONS[teamData.division?.id] ?? ['MLB', '地区不明'];
  const statsByPlayerId = activePlayerStats(active.roster);
  const players = merged.players.map(player => ({
    ...player,
    stats: player.status === 'ACTIVE' ? statsByPlayerId.get(Number(player.playerId)) ?? null : null,
  }));
  const matchedIds = new Set(players.map(player => Number(player.playerId)).filter(Boolean));
  const unmatchedActive = active.roster
    .filter(entry => !matchedIds.has(Number(entry.person?.id)))
    .map(entry => ({ playerId: entry.person?.id ?? null, officialName: entry.person?.fullName ?? null }));
  return {
    teamId: source.teamId,
    teamCode: source.teamCode,
    teamName: source.teamName,
    venueName: source.venueName,
    leagueName,
    divisionName,
    record: teamRecord(standings, source.teamId),
    manager: managerView(source, coaches),
    officialVenueName: teamData.venue?.name ?? null,
    players,
    counts,
    unresolved: merged.unresolved,
    unmatchedActive,
    fetchedAt,
  };
}

export const buildDetRoster = buildRoster;
