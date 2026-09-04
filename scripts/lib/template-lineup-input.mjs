import { resolveDisplayName } from './player-dictionary.mjs';
import { spotvTeamCode } from './mlb-team-map.mjs';

export const LINEUP_WRITE_ALLOWLIST = new Set([
  'B1', 'B2', 'B3', 'H3',
  'D4', 'E4', 'F4', 'J4', 'K4', 'L4',
  ...Array.from({ length: 9 }, (_, i) => [`D${i + 6}`, `E${i + 6}`, `J${i + 6}`, `K${i + 6}`, `O${i + 6}`, `P${i + 6}`]).flat(),
]);

function localDateParts(date, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(date).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
}

function formatTemplateDate(gameDate) {
  const parts = localDateParts(new Date(gameDate), 'America/New_York');
  return ` ${parts.month}/${parts.day} ${parts.hour}:${parts.minute}${parts.dayPeriod.toLowerCase()}  ET.`;
}

function formatJapanDate(gameDate) {
  const parts = localDateParts(new Date(gameDate), 'Asia/Tokyo');
  return `${parts.year}${parts.month.padStart(2, '0')}${parts.day.padStart(2, '0')}`;
}

function enrichPitcher(pitcher, mlbById) {
  if (!pitcher) return null;
  const official = mlbById.get(String(pitcher.playerId)) ?? {};
  return {
    ...official,
    ...pitcher,
    fullName: pitcher.fullName ?? official.fullName,
    jerseyNumber: pitcher.jerseyNumber ?? official.primaryNumber ?? null,
    pitchHand: pitcher.pitchHand ?? official.pitchHand ?? null,
  };
}

function selectPitcher(fixture, side, mlbById) {
  const probable = fixture.probablePitchers?.[side];
  const actual = fixture.actualStartingPitchers?.[side];
  if (probable && actual && probable.playerId !== actual.playerId) {
    throw new Error(`${side}: probable pitcher ${probable.playerId} differs from actual starter ${actual.playerId}`);
  }
  return enrichPitcher(probable && actual ? actual : probable ?? actual, mlbById);
}

function lineupCopyText(player) {
  const bat = player.batSide?.code;
  const position = player.position?.abbreviation;
  if (!bat || !position) throw new Error(`Missing batSide/position for playerId ${player.playerId}`);
  return `${player.fullName} (${bat}) ${position}`;
}

export function buildTemplateInput({ fixture, dictionary, spotvWorkbook, mlbPeople, displayNameOverrides = {} }) {
  const mlbById = new Map(mlbPeople.map(person => [String(person.id), person]));
  const sheetByCode = new Map(spotvWorkbook.sheets.map(sheet => [sheet.team, sheet]));
  const awayCode = spotvTeamCode(fixture.away.id);
  const homeCode = spotvTeamCode(fixture.home.id);
  const awayBusiness = sheetByCode.get(awayCode);
  const homeBusiness = sheetByCode.get(homeCode);
  if (!awayBusiness?.teamName || !homeBusiness?.teamName || !homeBusiness?.venueName) {
    throw new Error(`SPOTV business names missing for ${awayCode} @ ${homeCode}`);
  }
  const awayPitcher = selectPitcher(fixture, 'away', mlbById);
  const homePitcher = selectPitcher(fixture, 'home', mlbById);
  if (!awayPitcher || !homePitcher) throw new Error('Both probable pitchers are required');
  const awayPitcherName = resolveDisplayName(awayPitcher, dictionary);
  const homePitcherName = resolveDisplayName(homePitcher, dictionary);
  const values = {
    B1: formatTemplateDate(fixture.gameDate), B2: homeBusiness.venueName,
    B3: awayBusiness.teamName, H3: homeBusiness.teamName,
    D4: awayPitcher.jerseyNumber, E4: awayPitcherName.displayName, F4: awayPitcher.pitchHand?.code ?? '',
    J4: homePitcher.jerseyNumber, K4: homePitcherName.displayName, L4: homePitcher.pitchHand?.code ?? '',
  };
  const converted = { away: [], home: [] };
  for (const [side, columns] of [['away', { jersey: 'D', name: 'E', copy: 'O' }], ['home', { jersey: 'J', name: 'K', copy: 'P' }]]) {
    const lineup = fixture.startingLineups?.[side] ?? [];
    if (lineup.length !== 9 || lineup.some((player, i) => player.battingOrder !== i + 1 || player.sourceBattingOrderCode !== String((i + 1) * 100))) {
      throw new Error(`${side}: invalid initial lineup; expected exact slots 100..900`);
    }
    lineup.forEach((player, index) => {
      const row = index + 6;
      const conversion = resolveDisplayName(player, dictionary);
      const manualName = displayNameOverrides[String(player.playerId)]?.trim();
      if (manualName && !conversion.spotvFound) {
        conversion.displayName = manualName;
        conversion.status = 'manual-for-this-workbook';
      }
      values[`${columns.jersey}${row}`] = player.jerseyNumber ?? '';
      values[`${columns.name}${row}`] = conversion.displayName;
      values[`${columns.copy}${row}`] = lineupCopyText(player);
      converted[side].push({ ...player, conversion });
    });
  }
  const suffix = fixture.doubleHeader === 'Y' ? `_G${fixture.gameNumber}` : '';
  return {
    values,
    filename: `${formatJapanDate(fixture.gameDate)}_${awayCode}@${homeCode}${suffix}_スタメン表.xlsx`,
    metadata: {
      awayCode, homeCode, japanDate: formatJapanDate(fixture.gameDate), templateDate: values.B1,
      awayTeamName: values.B3, homeTeamName: values.H3, venueName: values.B2,
      pitchers: { away: { ...awayPitcher, conversion: awayPitcherName }, home: { ...homePitcher, conversion: homePitcherName } },
      lineups: converted,
    },
  };
}
