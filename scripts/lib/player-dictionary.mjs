import { matchingKey, normalizeName } from './name-normalization.mjs';

export function mergeMlbPeople(payloads) {
  const byId = new Map();
  for (const payload of payloads) {
    for (const person of payload.people ?? []) {
      if (!person?.id || !person.fullName || !person.birthDate) continue;
      const current = byId.get(person.id) ?? {};
      byId.set(person.id, { ...current, ...person, seasons: [...new Set([...(current.seasons ?? []), payload.season].filter(Boolean))].sort() });
    }
  }
  return [...byId.values()];
}

export function buildDictionary(spotvPlayers, mlbPeople, overrides = {}) {
  const byKey = new Map();
  const byNormalizedName = new Map();
  const byId = new Map(mlbPeople.map(p => [String(p.id), p]));
  for (const person of mlbPeople) {
    const key = matchingKey(person.fullName, person.birthDate);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(person);
    const name = normalizeName(person.fullName);
    if (!byNormalizedName.has(name)) byNormalizedName.set(name, []);
    byNormalizedName.get(name).push(person);
  }
  const dictionary = {};
  const unresolved = [];
  const resolvedRows = [];
  for (const row of spotvPlayers) {
    const override = Object.values(overrides).find(x =>
      normalizeName(x.spotvOfficialName) === normalizeName(row.officialName) && x.birthDate === row.birthDate
    );
    let candidates = byKey.get(matchingKey(row.officialName, row.birthDate)) ?? [];
    let status = 'auto-confirmed';
    let matchMethod = 'normalized-name+birthDate';
    if (override) {
      const person = byId.get(String(override.playerId)) ?? (
        override.playerId && override.mlbOfficialName && override.birthDate
          ? { id: Number(override.playerId), fullName: override.mlbOfficialName, birthDate: override.birthDate, manualOverrideOnly: true }
          : null
      );
      if (!person || person.birthDate !== row.birthDate) {
        unresolved.push({ ...row, reason: 'invalid-manual-override', candidatePlayerIds: person ? [person.id] : [] });
        continue;
      }
      if (override.spotvName && override.spotvName !== row.spotvName) {
        unresolved.push({ ...row, reason: 'manual-override-spotv-name-mismatch', candidatePlayerIds: [person.id] });
        continue;
      }
      candidates = [person]; status = 'manual-confirmed'; matchMethod = 'manual-override';
    }
    if (candidates.length !== 1) {
      const nameCandidates = byNormalizedName.get(normalizeName(row.officialName)) ?? [];
      const reason = candidates.length > 1 ? 'multiple-exact-candidates'
        : nameCandidates.length ? 'birth-date-mismatch' : 'official-name-not-found';
      unresolved.push({ ...row, reason, candidatePlayerIds: nameCandidates.map(x => x.id) });
      continue;
    }
    const person = candidates[0];
    const id = String(person.id);
    const entry = {
      playerId: person.id, spotvName: row.spotvName, officialName: person.fullName,
      spotvOfficialName: row.officialName, birthDate: row.birthDate,
      sourceTeam: row.sourceTeam, jerseyNumber: row.jerseyNumber,
      status, matchMethod,
    };
    if (dictionary[id] && (dictionary[id].spotvName !== entry.spotvName || dictionary[id].birthDate !== entry.birthDate)) {
      unresolved.push({ ...row, reason: 'player-id-conflict', candidatePlayerIds: [person.id] });
      continue;
    }
    dictionary[id] = entry;
    resolvedRows.push(entry);
  }
  return { dictionary, unresolved, resolvedRows };
}

export function resolveDisplayName(player, dictionary) {
  const match = dictionary[String(player.playerId)];
  return match ? {
    playerId: player.playerId, officialName: player.fullName, displayName: match.spotvName,
    spotvFound: true, spotvName: match.spotvName, matchMethod: match.matchMethod, status: match.status,
  } : {
    playerId: player.playerId, officialName: player.fullName, displayName: player.fullName,
    spotvFound: false, spotvName: null, matchMethod: null, status: 'fallback', fallbackReason: 'spotv-not-found',
  };
}

export function dictionaryDiff(previous = {}, current = {}, previousUnresolved = [], currentUnresolved = []) {
  const added = [], removed = [], spotvNameChanged = [], teamChanged = [], jerseyChanged = [];
  for (const [id, entry] of Object.entries(current)) {
    const old = previous[id];
    if (!old) added.push(entry);
    else {
      if (old.spotvName !== entry.spotvName) spotvNameChanged.push({ playerId: Number(id), from: old.spotvName, to: entry.spotvName });
      if (old.sourceTeam !== entry.sourceTeam) teamChanged.push({ playerId: Number(id), from: old.sourceTeam, to: entry.sourceTeam });
      if (old.jerseyNumber !== entry.jerseyNumber) jerseyChanged.push({ playerId: Number(id), from: old.jerseyNumber, to: entry.jerseyNumber });
    }
  }
  for (const [id, entry] of Object.entries(previous)) if (!current[id]) removed.push(entry);
  const unresolvedKey = x => matchingKey(x.officialName, x.birthDate);
  const before = new Set(previousUnresolved.map(unresolvedKey));
  const after = new Set(currentUnresolved.map(unresolvedKey));
  return {
    added, removed, spotvNameChanged, teamChanged, jerseyChanged,
    unresolvedToResolved: [...before].filter(x => !after.has(x)),
    resolvedToUnresolved: [...after].filter(x => !before.has(x)),
  };
}
