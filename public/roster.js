(() => {
  const sectionIds = {
    '投手': 'roster-pitchers',
    '捕手': 'roster-catchers',
    '内野手': 'roster-infielders',
    '外野手': 'roster-outfielders',
    '指名打者': 'roster-dh',
    '二刀流': 'roster-dh',
  };

  const escapeHtml = value => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  function statGrid(player) {
    if (player.status !== 'ACTIVE' || !player.stats) return '';
    const stat = player.stats;
    if (player.category === '投手') {
      return `<div class="roster-player-stats roster-pitching-stats">
        <span>${escapeHtml(stat.gamesPitched ?? stat.gamesPlayed ?? 0)}試合</span>
        <span>${escapeHtml(stat.wins ?? 0)}勝${escapeHtml(stat.losses ?? 0)}敗</span>
        <span>防御率${escapeHtml(stat.era ?? '-.--')}</span>
        <span>${Number(stat.saves) > 0 ? `${escapeHtml(stat.saves)}セーブ` : ''}</span>
      </div>`;
    }
    return `<div class="roster-player-stats roster-hitting-stats">
      <span>打率${escapeHtml(stat.avg ?? '.---')}</span>
      <span>OPS ${escapeHtml(stat.ops ?? '.---')}</span>
      <span>${escapeHtml(stat.homeRuns ?? 0)}本塁打</span>
      <span>${escapeHtml(stat.rbi ?? 0)}打点</span>
    </div>`;
  }

  function playerRow(player) {
    return `<div class="roster-player roster-status-${player.status.toLowerCase().replace(/[^a-z]/g, '')}">
      <div class="roster-number">${escapeHtml(player.jerseyNumber ?? '--')}</div>
      <div class="roster-player-names">
        <strong>${escapeHtml(player.spotvName)}</strong>
        <span>${escapeHtml(player.mlbOfficialName)}</span>
      </div>
      ${statGrid(player)}
      <div class="roster-player-position">${escapeHtml(player.batsThrows ?? '')}</div>
      <div class="roster-player-status"><span></span>${escapeHtml(player.status)}</div>
    </div>`;
  }

  function formatUpdated(iso) {
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso));
  }

  function render(data) {
    const logo = `https://www.mlbstatic.com/team-logos/${Number(data.teamId)}.svg`;
    document.getElementById('roster-team-logo').src = logo;
    document.getElementById('roster-team-logo').alt = data.teamName;
    document.getElementById('roster-watermark').src = logo;
    document.getElementById('roster-kicker').textContent = `${data.teamCode} ROSTER`;
    document.getElementById('roster-sheet').style.setProperty('--roster-team-color', window.mlbTeamColor?.(data.teamId) ?? '#0b4f82');
    document.getElementById('roster-team-name').textContent = data.teamName;
    document.getElementById('roster-record').textContent = `${data.record.wins}勝 ${data.record.losses}敗`;
    document.getElementById('roster-standing').textContent = `${data.leagueName} ${data.divisionName} ${data.record.divisionRank}位`;
    document.getElementById('roster-venue').textContent = data.venueName;
    document.getElementById('roster-venue-en').textContent = data.officialVenueName?.toUpperCase() ?? 'BALLPARK';
    document.getElementById('roster-manager').textContent = data.manager.displayName;
    document.getElementById('roster-updated').textContent = `最終更新：${formatUpdated(data.fetchedAt)} JST`;
    const sections = {};
    for (const id of new Set(Object.values(sectionIds))) {
      sections[id] = { active: [], inactive: [] };
    }
    for (const player of data.players) {
      const id = sectionIds[player.category] ?? 'roster-dh';
      sections[id][player.status === 'ACTIVE' ? 'active' : 'inactive'].push(playerRow(player));
    }
    for (const [id, groups] of Object.entries(sections)) {
      const container = document.getElementById(id);
      container.closest('.roster-group').classList.toggle('roster-group-no-active', groups.active.length === 0);
      container.innerHTML = [
        groups.active.length ? `<div class="roster-active">${groups.active.join('')}</div>` : '',
        groups.inactive.length ? `<div class="roster-nonactive">${groups.inactive.join('')}</div>` : '',
      ].join('');
    }
  }

  let currentTeamId = null;
  let currentDate = '';
  let currentHasStats = false;
  let currentGameContext = { doubleHeader: 'N', gameNumber: 1 };
  async function load({ teamId = currentTeamId, force = false, includeStats = currentHasStats, date = currentDate, doubleHeader = currentGameContext.doubleHeader, gameNumber = currentGameContext.gameNumber } = {}) {
    currentTeamId = Number(teamId);
    currentDate = date;
    currentHasStats = includeStats;
    currentGameContext = { doubleHeader, gameNumber };
    const message = document.getElementById('roster-message');
    const refresh = document.getElementById('refresh-roster');
    refresh.disabled = true;
    message.textContent = force ? '最新のロースターを取得しています…' : 'MLB公式ロースターを取得しています…';
    try {
      const params = new URLSearchParams();
      if (force) params.set('refresh', '1');
      if (includeStats) params.set('stats', '1');
      if (currentDate) params.set('date', currentDate);
      params.set('doubleHeader', currentGameContext.doubleHeader);
      params.set('gameNumber', String(currentGameContext.gameNumber));
      const data = await window.rosterApi(`/api/roster/${currentTeamId}?${params}`);
      render(data);
      const warnings = [];
      if (data.unmatchedActive?.length) warnings.push(`読み表と一致しないACTIVE選手 ${data.unmatchedActive.length}名`);
      if (data.unresolved?.length) warnings.push(`playerId未解決 ${data.unresolved.length}名`);
      message.textContent = warnings.join(' / ');
    } catch (error) {
      message.textContent = error.message;
    } finally {
      refresh.disabled = false;
    }
  }

  document.getElementById('refresh-roster').addEventListener('click', () => load({ force: true }));
  document.getElementById('print-roster').addEventListener('click', () => window.print());
  const activeToggle = document.getElementById('toggle-active-roster');
  activeToggle.addEventListener('click', async () => {
    const activeOnly = document.getElementById('roster-sheet').classList.toggle('roster-active-only');
    activeToggle.setAttribute('aria-pressed', String(activeOnly));
    activeToggle.innerHTML = activeOnly
      ? '<span aria-hidden="true"></span>全選手を表示'
      : '<span aria-hidden="true"></span>ACTIVEのみ表示';
    if (activeOnly && !currentHasStats) await load({ includeStats: true });
  });
  window.roster = { load };
})();
