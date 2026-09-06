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

  function playerRow(player) {
    return `<div class="roster-player roster-status-${player.status.toLowerCase().replace(/[^a-z]/g, '')}">
      <div class="roster-number">${escapeHtml(player.jerseyNumber ?? '--')}</div>
      <div class="roster-player-names">
        <strong>${escapeHtml(player.spotvName)}</strong>
        <span>${escapeHtml(player.mlbOfficialName)}</span>
      </div>
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
    document.getElementById('roster-team-name').textContent = data.teamName;
    document.getElementById('roster-record').textContent = `${data.record.wins}勝 ${data.record.losses}敗`;
    document.getElementById('roster-standing').textContent = `${data.leagueName} ${data.divisionName} ${data.record.divisionRank}位`;
    document.getElementById('roster-venue').textContent = data.venueName;
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
      document.getElementById(id).innerHTML = [
        groups.active.length ? `<div class="roster-active">${groups.active.join('')}</div>` : '',
        groups.inactive.length ? `<div class="roster-nonactive">${groups.inactive.join('')}</div>` : '',
      ].join('');
    }
  }

  async function load({ force = false } = {}) {
    const message = document.getElementById('roster-message');
    const refresh = document.getElementById('refresh-roster');
    refresh.disabled = true;
    message.textContent = force ? '最新のロースターを取得しています…' : 'MLB公式ロースターを取得しています…';
    try {
      const data = await window.detRosterApi(`/api/roster/det${force ? '?refresh=1' : ''}`);
      render(data);
      message.textContent = '';
    } catch (error) {
      message.textContent = error.message;
    } finally {
      refresh.disabled = false;
    }
  }

  document.getElementById('refresh-roster').addEventListener('click', () => load({ force: true }));
  window.detRoster = { load };
})();
