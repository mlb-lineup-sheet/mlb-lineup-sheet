const events = {
  single: 'シングル', double: '二塁打', triple: '三塁打', home_run: '本塁打',
  strikeout: '三振', strikeout_double_play: '三振・併殺', walk: '四球', intent_walk: '敬遠',
  hit_by_pitch: '死球', field_out: 'アウト', force_out: 'フォースアウト',
  grounded_into_double_play: '併殺打', double_play: '併殺', triple_play: '三重殺',
  field_error: '失策', fielders_choice: '野手選択', fielders_choice_out: '野手選択',
  sac_fly: '犠牲フライ', sac_bunt: '犠牲バント', catcher_interf: '打撃妨害',
};

const pitchNames = { FF: 'フォーシーム', SI: 'シンカー', FC: 'カッター', SL: 'スライダー', ST: 'スイーパー', CU: 'カーブ', KC: 'ナックルカーブ', CH: 'チェンジアップ', FS: 'スプリット', FO: 'フォーク', KN: 'ナックル', EP: 'イーファス', SV: 'スラーブ' };
const calls = { B: 'ボール', C: '見逃し', S: '空振り', F: 'ファウル', T: 'ファウルチップ', X: 'インプレー', D: 'インプレー', E: 'インプレー', W: '空振り', H: '死球', P: 'ピッチアウト', V: '自動ボール' };
const finite = n => typeof n === 'number' && Number.isFinite(n) ? n : null;
export function pitchView(play) {
  return (play?.playEvents ?? []).filter(event => event.isPitch).map((event, index) => {
    const p = event.pitchData ?? {};
    const d = event.details ?? {};
    const speed = finite(p.startSpeed);
    return {
      number: event.pitchNumber ?? index + 1,
      x: finite(p.coordinates?.pX), z: finite(p.coordinates?.pZ),
      top: finite(p.strikeZoneTop), bottom: finite(p.strikeZoneBottom),
      speed, kmh: speed === null ? null : Math.round(speed * 1.609344 * 10) / 10,
      type: pitchNames[d.type?.code] ?? d.type?.description ?? '球種未取得',
      result: calls[d.call?.code ?? d.code] ?? d.description ?? '結果未取得',
      kind: d.isInPlay ? 'inplay' : d.isBall ? 'ball' : d.isStrike ? 'strike' : 'other',
      count: event.count ?? null,
    };
  });
}

// Prefer official hit location; leave the direction absent when it is unavailable.
export function battingResult(play) {
  const type = play.result?.eventType;
  const hit = (play.playEvents ?? []).findLast(event => event.hitData)?.hitData;
  const direction = {1:'投',2:'捕',3:'一',4:'二',5:'三',6:'遊',7:'左',8:'中',9:'右',78:'左中',89:'右中'}[hit?.location] ?? '';
  const simple = {strikeout:'三振',strikeout_double_play:'三振併',walk:'四球',intent_walk:'敬遠',hit_by_pitch:'死球',catcher_interf:'打妨'};
  if (simple[type]) return simple[type];
  const suffix = {single:'安',double:'二',triple:'三',home_run:'本',field_error:'失',fielders_choice:'野選',fielders_choice_out:'野選',force_out:'ゴ',grounded_into_double_play:'併',double_play:'併',triple_play:'三重殺',sac_fly:'犠飛',sac_fly_double_play:'犠飛併',sac_bunt:'犠打',sac_bunt_double_play:'犠打併'}[type];
  if (suffix) return direction + suffix;
  if (type === 'field_out') return direction + ({ground_ball:'ゴ',line_drive:'直',fly_ball:'飛',popup:'飛',bunt_grounder:'ゴ',bunt_popup:'飛'}[hit?.trajectory] ?? 'アウト');
  return events[type] ?? play.result?.event ?? '打席終了';
}

export function buildLiveView(live, { teamName = team => team.name, playerName = person => person.fullName } = {}) {
  const data = live.gameData ?? {};
  const score = live.liveData?.linescore ?? {};
  const plays = live.liveData?.plays ?? {};
  const current = plays.currentPlay;
  const status = data.status ?? {};
  const finished = status.abstractGameState === 'Final';
  const statusLabels = { 'Delayed': '試合中断', 'Delayed: Rain': '雨天中断', 'Postponed': '延期', 'Cancelled': '中止', 'Suspended': 'サスペンデッド', 'Warmup': '開始準備中' };
  const interrupted = /delay|suspend|postpon|cancel/i.test(status.detailedState ?? '');
  const inProgress = status.abstractGameState === 'Live' && !interrupted;
  const activeAtBat = inProgress && current && !current.about?.isComplete && score.inningState !== 'Middle' && score.inningState !== 'End';
  const person = source => {
    if (!source?.id) return null;
    const full = { ...source, ...data.players?.[`ID${source.id}`] };
    return { id: source.id, name: playerName(full), officialName: full.fullName, bats: full.batSide?.code ?? null, throws: full.pitchHand?.code ?? null };
  };
  const boxTeams = live.liveData?.boxscore?.teams ?? {};
  const positions = { P: '投', C: '捕', '1B': '一', '2B': '二', '3B': '三', SS: '遊', LF: '左', CF: '中', RF: '右', DH: '指', PH: '代打', PR: '代走' };
  const sideFor = id => ['away', 'home'].find(side => boxTeams[side]?.players?.[`ID${id}`]);
  const changedPositions = new Map();
  const lastPitcher = Object.fromEntries(['away', 'home'].map(side => [side, boxTeams[side]?.pitchers?.[0]]));
  const substitutions = { away: [], home: [] };
  for (const play of plays.allPlays ?? []) {
    for (const event of play.playEvents ?? []) {
      const type = event.details?.eventType;
      if (!['pitching_substitution', 'offensive_substitution', 'defensive_substitution', 'defensive_switch'].includes(type)) continue;
      const id = event.player?.id;
      const side = sideFor(id);
      if (!side) continue;
      if (event.position?.abbreviation) changedPositions.set(id, event.position.abbreviation);
      const previous = event.replacedPlayer?.id ?? (type === 'pitching_substitution' ? lastPitcher[side] : null);
      if (type === 'pitching_substitution') lastPitcher[side] = id;
      substitutions[side].push({
        key: `${play.atBatIndex}:${event.index}:${id}`,
        inning: play.about?.inning, half: play.about?.isTopInning ? '表' : '裏',
        incoming: person({ id }), outgoing: previous ? person({ id: previous }) : null,
        position: positions[event.position?.abbreviation] ?? event.position?.abbreviation ?? '',
        type: type === 'pitching_substitution' ? '投手交代' : type === 'defensive_switch' ? '守備変更' : type === 'offensive_substitution' ? '攻撃交代' : '守備交代',
        description: event.details?.description ?? '',
      });
    }
  }
  const member = (side, id, order = null, pitching = false) => {
    const player = boxTeams[side]?.players?.[`ID${id}`];
    if (!player) return null;
    const position = pitching ? 'P' : changedPositions.get(id) ?? player.position?.abbreviation;
    return { ...person(player.person), order, position: positions[position] ?? position ?? '—',
      stats: player.seasonStats?.[pitching ? 'pitching' : 'batting'] ?? {}, pitching,
      todayPitching: pitching ? player.stats?.pitching ?? null : null,
      today: pitching ? [] : (plays.allPlays ?? []).filter(play => {
        const eventType = play.result?.eventType ?? '';
        const isBaserunningResult = /^(?:caught_stealing|stolen_base|pickoff|pickoff_caught_stealing|runner_double_play|other_advance)(?:_|$)/.test(eventType);
        return play.about?.isComplete && play.matchup?.batter?.id === id && (!play.result?.type || play.result.type === 'atBat') && !isBaserunningResult;
      }).map(play => ({ label: battingResult(play), isOut: Boolean(play.result?.isOut), isHit: ['single', 'double', 'triple', 'home_run'].includes(play.result?.eventType), rbi: play.result?.rbi ?? 0, inning: play.about.inning })) };
  };
  const members = Object.fromEntries(['away', 'home'].map(side => {
    const team = boxTeams[side] ?? {};
    const pitcherId = Object.values(team.players ?? {}).find(p => p.gameStatus?.isCurrentPitcher)?.person?.id ?? team.pitchers?.at(-1);
    return [side, { lineup: (team.battingOrder ?? []).map((id, i) => member(side, id, i + 1)).filter(Boolean), pitcher: member(side, pitcherId, null, true) }];
  }));
  const fieldPositions = { pitcher: '投', catcher: '捕', first: '一', second: '二', third: '三', shortstop: '遊', left: '左', center: '中', right: '右' };
  const defense = Object.entries(fieldPositions).map(([key, label]) => ({ key, label, player: person(score.defense?.[key]) }));
  return {
    members, substitutions, defense, defenseTeamId: score.defense?.team?.id ?? null,
    gamePk: live.gamePk, updatedAt: live.metaData?.timeStamp ?? null,
    finished, inProgress, status: finished ? '試合終了' : interrupted ? (statusLabels[status.detailedState] ?? status.detailedState) : inProgress ? '試合中' : (statusLabels[status.detailedState] ?? '試合開始前'),
    detailStatus: status.detailedState,
    inning: score.currentInning ?? null, half: score.isTopInning === true ? '表' : score.isTopInning === false ? '裏' : '',
    inningState: score.inningState ?? null,
    teams: Object.fromEntries(['away', 'home'].map(side => [side, {
      id: data.teams?.[side]?.id, name: teamName(data.teams?.[side] ?? {}),
      runs: score.teams?.[side]?.runs ?? null, hits: score.teams?.[side]?.hits ?? null, errors: score.teams?.[side]?.errors ?? null,
    }])),
    innings: (score.innings ?? []).map(inning => ({ num: inning.num, away: inning.away?.runs ?? null, home: inning.home?.runs ?? null })),
    currentAtBat: current ? { index: current.atBatIndex, inning: current.about?.inning, half: current.about?.isTopInning ? '表' : '裏', batSide: current.matchup?.batSide?.code ?? null, batter: person(current.matchup?.batter), pitcher: person(current.matchup?.pitcher), complete: Boolean(current.about?.isComplete), pitches: pitchView(current) } : null,
    matchup: activeAtBat ? { batSide: current.matchup?.batSide?.code ?? null, batter: person(current.matchup?.batter), pitcher: person(current.matchup?.pitcher) } : null,
    count: activeAtBat ? { balls: score.balls ?? null, strikes: score.strikes ?? null, outs: score.outs ?? null } : null,
    bases: activeAtBat ? ['first', 'second', 'third'].map(base => person(score.offense?.[base])) : [null, null, null],
    plays: (plays.allPlays ?? []).filter(play => play.about?.isComplete).map(play => ({
      pitches: pitchView(play),
      index: play.atBatIndex, inning: play.about.inning, half: play.about.isTopInning ? '表' : '裏',
      batter: person(play.matchup?.batter), pitcher: person(play.matchup?.pitcher),
      event: events[play.result?.eventType] ?? play.result?.event ?? '打席終了',
      description: play.result?.description ?? '', rbi: play.result?.rbi ?? 0,
      awayScore: play.result?.awayScore ?? null, homeScore: play.result?.homeScore ?? null,
    })).reverse(),
  };
}
