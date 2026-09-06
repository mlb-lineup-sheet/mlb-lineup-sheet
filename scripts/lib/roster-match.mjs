const IL_CODES = new Set(['D7', 'D10', 'D15', 'D60', 'ILF']);
const OTHER_CODES = new Set(['RST', 'TI', 'DEV', 'BRV', 'PAT', 'SUSP']);

export function normalizeRosterName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|ii|iii)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function personFrom(entry) {
  return entry?.person ?? {};
}

export function matchRosterPlayer(sourcePlayer, apiEntries) {
  if (sourcePlayer.playerId) {
    const byId = apiEntries.find(entry => Number(personFrom(entry).id) === Number(sourcePlayer.playerId));
    if (byId) return { entry: byId, method: 'playerId' };
  }

  const normalized = normalizeRosterName(sourcePlayer.officialName);
  const candidates = apiEntries.filter(entry => {
    const person = personFrom(entry);
    return normalizeRosterName(person.fullName) === normalized && person.birthDate === sourcePlayer.birthDate;
  });
  return candidates.length === 1
    ? { entry: candidates[0], method: 'normalized-name+birthDate' }
    : { entry: null, method: null, candidateCount: candidates.length };
}

export function classifyRosterStatus(playerId, activeIds, fortyManEntry) {
  if (activeIds.has(Number(playerId))) return 'ACTIVE';
  const code = fortyManEntry?.status?.code ?? null;
  const description = fortyManEntry?.status?.description ?? '';
  if (IL_CODES.has(code) || /Injured/i.test(description)) return 'IL';
  if (code === 'RM' || /Minors?/i.test(description)) return 'MINOR';
  if (!fortyManEntry) return 'MINOR';
  if (OTHER_CODES.has(code) || /Restricted|Inactive|Development|Bereavement|Paternity|Suspended/i.test(description)) return 'OTHER';
  return '40-MAN';
}

export function mergeRosterStatus(sourcePlayers, activeRoster = [], fortyManRoster = []) {
  const activeIds = new Set(activeRoster.map(entry => Number(personFrom(entry).id)));
  const apiEntries = [...fortyManRoster, ...activeRoster];
  const fortyById = new Map(fortyManRoster.map(entry => [Number(personFrom(entry).id), entry]));
  const unresolved = [];
  const players = sourcePlayers.map(sourcePlayer => {
    const match = matchRosterPlayer(sourcePlayer, apiEntries);
    const playerId = Number(sourcePlayer.playerId ?? personFrom(match.entry).id);
    if (!playerId) unresolved.push({ officialName: sourcePlayer.officialName, birthDate: sourcePlayer.birthDate });
    const fortyManEntry = fortyById.get(playerId) ?? null;
    return {
      ...sourcePlayer,
      playerId: playerId || null,
      mlbOfficialName: personFrom(match.entry).fullName ?? sourcePlayer.officialName,
      matchMethod: sourcePlayer.playerId ? 'playerId' : match.method,
      status: classifyRosterStatus(playerId, activeIds, fortyManEntry),
      apiStatusCode: fortyManEntry?.status?.code ?? (activeIds.has(playerId) ? 'A' : null),
      apiStatus: fortyManEntry?.status?.description ?? (activeIds.has(playerId) ? 'Active' : 'Not on 40-man roster'),
      apiNote: fortyManEntry?.note ?? null,
    };
  });
  return { players, unresolved };
}
