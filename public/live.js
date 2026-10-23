(() => {
  const content = document.getElementById('live-content');
  const message = document.getElementById('live-message');
  const updated = document.getElementById('live-updated');
  const demoButton = document.getElementById('live-sub-demo');
  const preview = document.getElementById('live-preview');
  const refresh = document.getElementById('live-refresh');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const value = number => esc(number ?? '—');
  let session = null;
  function stop() {
    if (session) { clearTimeout(session.timer); clearTimeout(session.demoTimer); session.controller?.abort(); }
    session = null;
  }
  const logo = id => `<img src="https://www.mlbstatic.com/team-logos/${Number(id)}.svg" alt="">`;
  function pitchingResults(stats) {
    if (!stats) return '';
    const match = /^(\d+)(?:\.([012]))?$/.exec(String(stats.inningsPitched ?? ''));
    const innings = match ? `${match[1]}${match[2] && match[2] !== '0' ? ` ${match[2]}/3` : ''}` : '—';
    const fields = [['球',stats.numberOfPitches ?? stats.pitchesThrown],['回',innings],['失',stats.runs],['自',stats.earnedRuns],['三',stats.strikeOuts],['安',stats.hits],['四',stats.baseOnBalls],['死',stats.hitBatsmen ?? stats.hitByPitch]];
    return `<div class="live-member-results live-pitching-results" aria-label="本日の投手成績">${fields.map(([label,stat]) => `<span class="live-pitching-stat"><b>${label}</b>${value(stat)}</span>`).join('')}</div>`;
  }
  function memberRow(player, order, side) {
    const until = session?.changes?.get(`${side}:${order}`) ?? 0;
    const changed = until > Date.now();
    const results = (player?.today ?? []).map(result => `<span class="${result.rbi > 0 ? 'live-result-rbi' : result.isHit ? 'live-result-hit' : result.isOut ? 'live-result-out' : ''}" title="${value(result.inning)}回・${value(result.rbi)}打点">${esc(result.label)}</span>`).join('');
    return `<div class="live-member ${changed ? 'member-changed' : ''} ${player?.id === session?.game?.matchup?.batter?.id ? 'member-atbat' : ''}" data-member="${side}:${order}" style="animation-delay:${changed ? Math.min(0, until-Date.now()-15000) : 0}ms">
      <b class="live-member-order">${order}</b><span class="live-member-position">${esc(player?.position ?? '—')}</span><div class="live-member-copy"><strong>${esc(player?.name ?? '未発表')}</strong>${player?.pitching ? pitchingResults(player.todayPitching) : ''}${player && !player.pitching && results ? `<div class="live-member-results" aria-label="本日の打席結果">${results}</div>` : ''}</div>
    </div>`;
  }

  function membersView(game, side) {
    const team = game.teams[side];
    const members = game.members?.[side];
    return `<section class="live-members live-members-${side}" aria-label="${esc(team.name)}の出場メンバー"><header>${logo(team.id)}<h2>${esc(team.name)}</h2></header><div class="live-members-body">${Array.from({length:9},(_,i)=>memberRow(members?.lineup?.find(p=>p.order===i+1),i+1,side)).join('')}${memberRow(members?.pitcher,'P',side)}</div></section>`;
  }
  function fieldFlash(player, game) {
    if (!player?.id) return '';
    let until = session?.changes?.get(`field:${player.id}`) ?? 0;
    for (const side of ['away','home']) {
      const members = game.members?.[side];
      for (const member of members?.lineup ?? []) {
        if (member.id === player.id) until = Math.max(until, session?.changes?.get(`${side}:${member.order}`) ?? 0);
      }
      if (members?.pitcher?.id === player.id) until = Math.max(until, session?.changes?.get(`${side}:P`) ?? 0);
    }
    return until > Date.now() ? `class="field-changed" style="animation-delay:${Math.min(0,until-Date.now()-15000)}ms"` : '';
  }
  function fieldView(game) {
    if (session?.preview) {
      const side = game.teams.away.id === game.defenseTeamId ? 'home' : 'away';
      const lineup = game.members?.[side]?.lineup ?? [];
      const batter = lineup[3] ?? { name: '打者（仮）' };
      const pitcher = game.members?.[side === 'home' ? 'away' : 'home']?.pitcher;
      const recordedSide = game.currentAtBat?.batter?.id === batter.id ? game.currentAtBat?.batSide : null;
      const batSide = recordedSide ?? (batter.bats === 'S' ? pitcher?.throws === 'L' ? 'R' : pitcher?.throws === 'R' ? 'L' : null : batter.bats);
      game = { ...game, bases: [0,1,2].map(i => lineup[i] ?? { name: `${i+1}塁走者（仮）` }), matchup: { batter, batSide } };
    }
    const batSide = game.matchup?.batSide ?? game.matchup?.batter?.bats;
    const boxSide = ['R','L'].includes(batSide) ? batSide : 'unknown';
    const positions = { left:[25,28], center:[50,17], right:[75,28], shortstop:[34,43], second:[66,43], third:[28,55], first:[72,55], pitcher:[50,61], catcher:[50,93] };
    const runnerPositions = [[68,68],[50,35],[32,68]];
    // Home is (300,435); foul lines are x+y=735 and y-x=135.
    // Shift the first/third bags toward fair territory so their outer edge meets the line.
    const bagInset = 7 * Math.SQRT2 / 2;
    const baseCenters = [[412-bagInset,323-bagInset],[300,211],[188+bagInset,323-bagInset]];
    const counter = [['B', 'balls', 3], ['S', 'strikes', 2], ['O', 'outs', 2]].map(([label, key, total]) => {
      const count = game.count?.[key];
      const available = Number.isInteger(count) && count >= 0 && count <= total;
      return `<div class="live-bso-group live-bso-${key}" aria-label="${label}: ${available ? count : '—'}"><b>${label}</b><span class="live-bso-lights" aria-hidden="true">${Array.from({length:total}, (_, i) => `<i class="${available && i < count ? 'is-lit' : ''}"></i>`).join('')}</span></div>`;
    }).join('');
    return `<section class="live-diamond-panel"><div class="live-bso" role="group" aria-label="ボール・ストライク・アウト">${counter}</div>${session?.preview ? `<div class="live-preview-notice">${session?.demoGame ? esc(`${session.demoPending ? '交代前' : '交代後'}：${session.demoChange?.outgoing?.name ?? ''} → ${session.demoChange?.incoming?.name ?? ''}（デモ）`) : '配置確認用：打者・走者は仮の配置です'}</div>` : ''}<div class="live-diamond">

      <svg viewBox="0 0 600 500" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs><radialGradient id="live-turf"><stop stop-color="#397e5d"/><stop offset="1" stop-color="#143f35"/></radialGradient></defs>
        <rect width="600" height="500" fill="#397e5d"/>
        <path d="M300 435 L20 155 Q300 -90 580 155 Z" fill="url(#live-turf)" stroke="#81ad92" stroke-width="3"/>
        <path d="M300 435 L75 210 Q300 0 525 210 Z" fill="#fff" opacity=".04"/>
        <path d="M300 435 L125 265 Q300 75 475 265 Z" fill="#fff" opacity=".04"/>
        <path d="M300 211 L412 323 L300 435 L188 323 Z" fill="#397e5d"/>
        <path d="M150 315 Q165 182 300 176 Q435 182 450 315 L424 341 Q412 348 400 335 L300 235 L200 335 Q188 348 176 341 Z" fill="#b19775"/>
        <path d="M188 323 L300 435 L412 323" fill="none" stroke="#b19775" stroke-width="23" stroke-linejoin="round"/>
        <circle data-home-dirt cx="300" cy="426" r="43" fill="#b19775"/>
        <path data-foul-lines d="M20 155 L270 405 M330 405 L580 155" fill="none" stroke="#f5efdc" stroke-width="2"/>
        <circle cx="300" cy="329" r="17" fill="#b19775"/><path d="M294 329 H306" stroke="white" stroke-width="3"/>
        ${baseCenters.map(([x,y],i)=>`<rect data-field-base="${i+1}" x="${x-7}" y="${y-7}" width="14" height="14" transform="rotate(45 ${x} ${y})" fill="#fff"/>`).join('')}
        <g fill="none" stroke="#fff" stroke-width="1.5">
          <rect x="271" y="407" width="17" height="32"/>
          <rect x="312" y="407" width="17" height="32"/>
        </g>
        <path d="M293 419 H307 V428 L300 435 L293 428 Z" fill="white"/>

      </svg>
      ${(game.defense ?? []).map(({key,player})=>{const [x,y]=positions[key];return `<div class="live-field-name live-field-defender" style="left:${x}%;top:${y}%"><strong ${fieldFlash(player,game)}>${esc(player?.name ?? '—')}</strong></div>`;}).join('')}
      ${(game.bases ?? []).map((runner,i)=>runner ? `<div class="live-field-name live-field-runner" style="left:${runnerPositions[i][0]}%;top:${runnerPositions[i][1]}%"><strong ${fieldFlash(runner,game)}>${esc(runner.name)}</strong></div>` : '').join('')}
      <div class="live-field-name live-field-batter" data-bat-side="${boxSide}"><strong ${fieldFlash(game.matchup?.batter,game)}>${esc(game.matchup?.batter?.name ?? '—')}</strong></div>
    </div></section>`;
  }
  function scoreView(game) {
    const innings = Array.from({length:Math.max(9,...game.innings.map(i=>i.num))},(_,i)=>i+1);
    const battingSide = game.inProgress && !game.finished && !['Middle','End'].includes(game.inningState)
      ? (game.half === '表' ? 'away' : game.half === '裏' ? 'home' : null) : null;
    return `<section class="live-center-score"><div class="live-center-status"><strong>${esc(game.status)}</strong><span>${game.inning ? `${esc(game.inning)}回${esc(game.half)}` : ''}</span></div><div class="live-center-score-scroll"><table><caption class="sr-only">イニング別スコア</caption><colgroup><col class="live-score-team-col">${innings.map(()=>'<col>').join('')}<col class="live-score-total-col" span="3"></colgroup><thead><tr><th scope="col">TEAM</th>${innings.map(i=>`<th scope="col">${i}</th>`).join('')}<th scope="col">R</th><th scope="col">H</th><th scope="col">E</th></tr></thead><tbody>${['away','home'].map(side=>`<tr><th scope="row">${logo(game.teams[side].id)}<span class="sr-only">${esc(game.teams[side].name)}</span></th>${innings.map(num=>`<td data-inning="${num}" data-side="${side}"${side === battingSide && num === game.inning ? ' class="live-inning-active" aria-label="攻撃中"' : ''}>${value(game.innings.find(i=>i.num===num)?.[side])}</td>`).join('')}${['runs','hits','errors'].map(key=>`<td class="live-total">${value(game.teams[side][key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
  }
  function changesView(game, side) {
    const history = [...(game.substitutions?.[side] ?? [])].reverse();
    return `<section class="live-change-history"><header><h2>交代履歴</h2><span>${esc(game.teams[side].name)}</span></header><div class="live-change-entries">${history.length ? history.map(change=>`<article><span>${esc(change.inning)}回${esc(change.half)}</span><div><small>${esc(change.type)}${change.position ? ' / '+esc(change.position) : ''}</small><p>${change.outgoing ? `${esc(change.outgoing.name)} <span aria-label="から">→</span> ` : ''}<strong>${esc(change.incoming?.name ?? '未取得')}</strong></p></div></article>`).join('') : '<p class="live-empty">交代はありません</p>'}</div></section>`;
  }
  function render(game) {
    game = session?.demoGame ?? game;
    demoButton.hidden = !session?.preview;
    demoButton.disabled = false;
    demoButton.textContent = session?.demoPending ? '交代を実行' : session?.demoGame ? 'デモを終了' : '交代デモ';
    preview.setAttribute('aria-pressed', String(Boolean(session?.preview)));
    preview.textContent = session?.preview ? '仮配置を解除' : '打者・走者を仮配置';
    content.innerHTML = `<div class="live-reference-board">${membersView(game,'away')}<div class="live-center">${scoreView(game)}${fieldView(game)}</div>${membersView(game,'home')}</div><div class="live-change-grid">${changesView(game,'away')}${changesView(game,'home')}</div>`;
    content.querySelectorAll('img').forEach(img=>{img.onerror=()=>{img.hidden=true;};});
  }
  function detectChanges(active, game) {
    const previous = active.game;
    active.changes ??= new Map();
    const now = Date.now();
    for (const [key, until] of active.changes) if (until < now) active.changes.delete(key);
    if (!previous) return;
    if (previous.defenseTeamId === game.defenseTeamId) {
      for (const defender of game.defense ?? []) {
        const old = previous.defense?.find(p => p.key === defender.key);
        if (old?.player && defender.player && old.player.id !== defender.player.id) active.changes.set(`field:${defender.player.id}`,now+15000);
      }
    }
    for (const side of ['away','home']) {
      const before = previous.members?.[side], after = game.members?.[side];
      if (!before?.lineup?.length || !after?.lineup?.length) continue;
      for (const player of after.lineup) {
        const old = before.lineup.find(p=>p.order===player.order);
        if (old && (old.id!==player.id || old.position!==player.position)) active.changes.set(`${side}:${player.order}`,now+15000);
      }
      if (before.pitcher && after.pitcher && before.pitcher.id!==after.pitcher.id) active.changes.set(`${side}:P`,now+15000);
    }
  }
  async function load(active) {
    if (session !== active || active.loading || document.hidden) return;
    clearTimeout(active.timer);
    active.loading = true;
    refresh.disabled = true;
    active.controller = new AbortController();
    const timeout = setTimeout(() => active.controller.abort(), 20000);
    try {
      const response = await fetch(`/api/games/${active.gamePk}/live`, { signal: active.controller.signal });
      const game = await response.json();
      if (!response.ok) throw new Error(game.error ?? `HTTP ${response.status}`);
      if (session !== active) return;
      detectChanges(active, game);
      active.game = game;
      render(game);
      active.finished = game.finished;
      active.hasData = true;
      message.textContent = '';
      updated.textContent = `${new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date())} JST 取得${game.finished ? ' · 試合終了' : ' · 15秒ごとに更新'}`;
    } catch (error) {
      if (session !== active) return;
      message.textContent = `${active.hasData ? '前回取得した内容を表示しています。' : ''}更新できませんでした。${error.name === 'AbortError' ? '通信がタイムアウトしました。' : error.message} 再取得を試みます。`;
    } finally {
      clearTimeout(timeout);
      active.loading = false;
      if (session === active) {
        refresh.disabled = false;
        if (!active.finished && !document.hidden) active.timer = setTimeout(() => load(active), 15000);
      }
    }
  }
  demoButton.addEventListener('click', () => {
    const active = session;
    if (!active?.preview || !active.game) return;
    if (active.demoPending && active.defenseDemoAfter) {
      active.demoGame = active.defenseDemoAfter; active.demoPending = false;
      for (const player of active.defenseDemoPlayers) {
        active.changes.set(`field:${player.id}`, Date.now() + 15000);
        const member = active.demoGame.members.away.lineup.find(p => p.id === player.id);
        if (member) active.changes.set(`away:${member.order}`, Date.now() + 15000);
      }
      render(active.game); return;
    }
    if (active.demoPending) {
      const { demoSide: side, demoChange: change } = active;
      const after = structuredClone(active.game);
      after.substitutions[side] = after.substitutions[side].map(c => c.key === change.key ? { ...c, type: '投手交代（デモ）' } : c);
      active.demoGame = after; active.demoPending = false;
      active.changes.set(`${side}:P`, Date.now() + 15000);
      render(active.game); return;
    }
    if (active.demoGame) {
      clearTimeout(active.demoTimer); active.demoGame = null; active.demoPending = false; active.defenseDemoAfter = null; active.changes.clear();
      render(active.game); return;
    }
    if (new URLSearchParams(location.search).get('demo') === 'defense8') {
      const after = structuredClone(active.game);
      const changes = after.substitutions.away.filter(c => c.inning === 8 && c.half === '裏' && c.type === '守備変更');
      const third = changes.find(c => c.position === '三');
      const second = changes.find(c => c.position === '二');
      const short = changes.find(c => c.position === '遊');
      if (!third || !second || !short?.outgoing) { message.textContent = 'この試合の8回裏の守備変更を取得できません。'; return; }
      const before = structuredClone(after);
      before.defense = before.defense.map(p => ({...p, player: p.key === 'shortstop' ? third.incoming : p.key === 'third' ? second.incoming : p.key === 'second' ? short.outgoing : p.player}));
      before.members.away.lineup = before.members.away.lineup.map(p => p.id === third.incoming.id ? {...p,position:'遊'} : p.id === second.incoming.id ? {...p,position:'三'} : p.id === short.incoming.id ? {...short.outgoing,order:p.order,position:'二',today:[]} : p);
      before.substitutions.away = before.substitutions.away.filter(c => !changes.some(change => change.key === c.key));
      active.demoChange = {outgoing:{name:'8回裏の守備変更前'},incoming:{name:'マゴニグル（三）・ペック（遊）・李灝宇（二）'}};
      active.defenseDemoAfter = after; active.defenseDemoPlayers = changes.map(c => c.incoming);
      active.demoGame = before; active.demoPending = true; active.changes.clear();
      render(active.game); return;
    }
    const game = active.game;
    const side = game.teams.away.id === game.defenseTeamId ? 'away' : 'home';
    const change = [...(game.substitutions?.[side] ?? [])].reverse().find(c => c.type === '投手交代' && c.outgoing && c.incoming?.id === game.members?.[side]?.pitcher?.id);
    if (!change) { message.textContent = 'この試合には再現できる投手交代がありません。'; return; }
    const before = structuredClone(game);
    before.members[side].pitcher = { ...change.outgoing, pitching: true, position: '投', stats: {} };
    before.defense = before.defense.map(p => p.key === 'pitcher' ? { ...p, player: change.outgoing } : p);
    before.substitutions[side] = before.substitutions[side].filter(c => c.key !== change.key);
    active.changes.clear();
    active.demoSide = side; active.demoChange = change;
    active.demoGame = before; active.demoPending = true;
    render(game);

  });
  preview.addEventListener('click', () => { if (!session?.game) return; clearTimeout(session.demoTimer); session.demoGame = null; session.demoPending = false; session.preview = !session.preview; render(session.game); });
  refresh.addEventListener('click', () => { if (session) load(session); });
  document.addEventListener('visibilitychange', () => {
    if (!session) return;
    clearTimeout(session.timer);
    if (!document.hidden && !session.finished) load(session);
  });
  window.liveGame = { stop, open(gamePk) {
    stop();
    content.innerHTML = '';
    updated.textContent = '';
    message.textContent = 'MLB公式データを取得しています…';
    session = { gamePk, loading: false, finished: false, preview: new URLSearchParams(location.search).get('preview') === '1' };
    return load(session);
  } };
})();
