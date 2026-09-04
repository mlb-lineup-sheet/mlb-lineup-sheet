const INITIAL_ORDER_CODES = Array.from({ length: 9 }, (_, index) => String((index + 1) * 100));

export function jstDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

export function jstDayBounds(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) throw new Error('date must be YYYY-MM-DD');
  const start = new Date(`${dateString}T00:00:00+09:00`);
  if (Number.isNaN(start.valueOf())) throw new Error('invalid JST date');
  return { start, end: new Date(start.valueOf() + 24 * 60 * 60 * 1000) };
}

export function scheduleQueryDates(jstDate) {
  const { start } = jstDayBounds(jstDate);
  const previous = new Date(start.valueOf() - 24 * 60 * 60 * 1000);
  return { startDate: jstDateString(previous), endDate: jstDate };
}

export function gamesOnJstDate(schedule, dateString) {
  const { start, end } = jstDayBounds(dateString);
  const byGamePk = new Map();
  for (const game of schedule.dates?.flatMap(date => date.games ?? []) ?? []) {
    const instant = new Date(game.gameDate);
    if (instant >= start && instant < end) byGamePk.set(game.gamePk, game);
  }
  return [...byGamePk.values()].sort((a, b) => new Date(a.gameDate) - new Date(b.gameDate));
}

function personDetails(live, id) {
  const person = live.gameData?.players?.[`ID${id}`] ?? {};
  return {
    playerId: id,
    fullName: person.fullName ?? null,
    batSide: person.batSide ? { code: person.batSide.code, description: person.batSide.description } : null,
    pitchHand: person.pitchHand ? { code: person.pitchHand.code, description: person.pitchHand.description } : null,
  };
}

export function extractInitialLineup(box, live, side) {
  const players = Object.values(box.teams?.[side]?.players ?? {});
  const lineup = [];
  const errors = [];
  for (const [index, code] of INITIAL_ORDER_CODES.entries()) {
    const candidates = players.filter(player => player.battingOrder === code);
    if (candidates.length !== 1) {
      errors.push(`${side} battingOrder ${code}: ${candidates.length}`);
      continue;
    }
    const player = candidates[0];
    const id = player.person?.id;
    // Boxscore keeps battingOrder=100..900 for the initial lineup, but after
    // defensive moves player.position is the player's final position. MLB
    // lists positions chronologically in allPositions, so the first entry is
    // the initial defensive position. Pregame boxscores may not have that
    // array yet, in which case position is still the correct fallback.
    const initialPosition = player.allPositions?.[0] ?? player.position;
    const position = initialPosition?.abbreviation;
    if (!id) errors.push(`${side} battingOrder ${code}: playerId missing`);
    if (!position) errors.push(`${side} battingOrder ${code}: position missing`);
    lineup.push({
      battingOrder: index + 1,
      ...personDetails(live, id),
      jerseyNumber: player.jerseyNumber ?? null,
      position: {
        code: initialPosition?.code ?? null,
        abbreviation: position ?? null,
        name: initialPosition?.name ?? null,
      },
      starter: true,
      sourceBattingOrderCode: code,
    });
  }
  if (lineup.length !== 9) errors.push(`${side}: expected 9 initial starters, got ${lineup.length}`);
  if (new Set(lineup.map(player => player.battingOrder)).size !== lineup.length) errors.push(`${side}: duplicate batting order`);
  if (new Set(lineup.map(player => player.playerId)).size !== lineup.length) errors.push(`${side}: duplicate playerId`);
  return { complete: errors.length === 0, lineup: errors.length ? [] : lineup, errors };
}

function actualStarter(box, live, side) {
  const candidates = Object.values(box.teams?.[side]?.players ?? {})
    .filter(player => player.stats?.pitching?.gamesStarted === 1);
  if (candidates.length !== 1) return null;
  const player = candidates[0];
  return { ...personDetails(live, player.person.id), jerseyNumber: player.jerseyNumber ?? null, starter: true };
}

function probable(scheduledGame, side) {
  const pitcher = scheduledGame.teams?.[side]?.probablePitcher;
  return pitcher ? { playerId: pitcher.id, fullName: pitcher.fullName } : null;
}

export function buildGameFixture({ scheduledGame, live, box }) {
  const away = extractInitialLineup(box, live, 'away');
  const home = extractInitialLineup(box, live, 'home');
  return {
    gamePk: scheduledGame.gamePk,
    officialDate: scheduledGame.officialDate,
    gameDate: scheduledGame.gameDate,
    venue: { id: scheduledGame.venue?.id ?? live.gameData?.venue?.id, name: scheduledGame.venue?.name ?? live.gameData?.venue?.name },
    status: scheduledGame.status,
    doubleHeader: scheduledGame.doubleHeader,
    gameNumber: scheduledGame.gameNumber,
    away: { id: scheduledGame.teams.away.team.id, name: scheduledGame.teams.away.team.name },
    home: { id: scheduledGame.teams.home.team.id, name: scheduledGame.teams.home.team.name },
    probablePitchers: { away: probable(scheduledGame, 'away'), home: probable(scheduledGame, 'home') },
    actualStartingPitchers: { away: actualStarter(box, live, 'away'), home: actualStarter(box, live, 'home') },
    startingLineups: { away: away.lineup, home: home.lineup },
    lineupStatus: away.complete && home.complete ? 'available' : 'incomplete',
    lineupErrors: { away: away.errors, home: home.errors },
    lineupAnnouncementEvidence: {
      awayInitialSlots: Object.values(box.teams?.away?.players ?? {}).filter(player => INITIAL_ORDER_CODES.includes(player.battingOrder)).map(player => player.battingOrder).sort(),
      homeInitialSlots: Object.values(box.teams?.home?.players ?? {}).filter(player => INITIAL_ORDER_CODES.includes(player.battingOrder)).map(player => player.battingOrder).sort(),
    },
  };
}

export function findScheduledGame(schedule, gamePk, live) {
  const candidates = schedule.dates?.flatMap(date => date.games ?? []).filter(game => game.gamePk === Number(gamePk)) ?? [];
  const liveDateTime = live.gameData?.datetime?.dateTime;
  return candidates.find(game => liveDateTime && game.gameDate === liveDateTime)
    ?? candidates.find(game => game.status?.detailedState === live.gameData?.status?.detailedState)
    ?? candidates[0]
    ?? null;
}
