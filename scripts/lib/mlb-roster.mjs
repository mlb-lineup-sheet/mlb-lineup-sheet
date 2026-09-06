import { mergeRosterStatus, normalizeRosterName } from './roster-match.mjs';

export function pregameStandingsDate(officialDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(officialDate ?? '')) throw new Error('現地日付が不正です');
  const date = new Date(`${officialDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
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

function detroitRecord(standings) {
  for (const record of standings.records ?? []) {
    const team = record.teamRecords?.find(item => item.team?.id === 116);
    if (team) return {
      wins: team.wins,
      losses: team.losses,
      divisionRank: Number(team.divisionRank),
      lastUpdated: team.lastUpdated ?? record.lastUpdated ?? null,
    };
  }
  throw new Error('DETの順位情報を取得できませんでした');
}

function detroitTeam(teamPayload) {
  const team = teamPayload.teams?.find(item => item.id === 116);
  if (!team) throw new Error('DETの球団情報を取得できませんでした');
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

export function buildDetRoster({ source, active, fortyMan, standings, coaches, team, fetchedAt }) {
  const merged = mergeRosterStatus(source.players, active.roster, fortyMan.roster);
  if (merged.unresolved.length) throw new Error(`DET roster突合未解決: ${merged.unresolved.length}件`);
  const counts = { ACTIVE: 0, IL: 0, MINOR: 0, '40-MAN': 0, OTHER: 0 };
  for (const player of merged.players) counts[player.status] += 1;
  const teamData = detroitTeam(team);
  const statsByPlayerId = activePlayerStats(active.roster);
  const players = merged.players.map(player => ({
    ...player,
    stats: player.status === 'ACTIVE' ? statsByPlayerId.get(Number(player.playerId)) ?? null : null,
  }));
  return {
    teamId: 116,
    teamName: source.teamName,
    venueName: source.venueName,
    leagueName: 'アメリカン・リーグ',
    divisionName: '中地区',
    record: detroitRecord(standings),
    manager: managerView(source, coaches),
    officialVenueName: teamData.venue?.name ?? null,
    players,
    counts,
    fetchedAt,
  };
}
