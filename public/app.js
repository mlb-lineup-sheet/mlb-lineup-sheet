const views = { login: document.getElementById('login-view'), games: document.getElementById('games-view'), lineup: document.getElementById('lineup-view') };
const state = { authenticated: false, games: [], currentGame: null };

function showView(name) {
  Object.values(views).forEach(view => view.classList.remove('view-active'));
  views[name].classList.add('view-active');
  window.scrollTo(0, 0);
}

const jstFormat = options => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', ...options }).format(new Date());
function jstDateString() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
document.getElementById('header-date').textContent = jstFormat({ year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) } });
  const data = (response.headers.get('content-type') ?? '').includes('application/json') ? await response.json() : null;
  if (response.status === 401 && !['/api/login', '/api/session'].includes(url)) { state.authenticated = false; showView('login'); }
  if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
  return data;
}

const passwordInput = document.getElementById('password-input');
const loginMessage = document.getElementById('login-message');
document.getElementById('login-form').addEventListener('submit', async event => {
  event.preventDefault(); loginMessage.textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password: passwordInput.value }) });
    passwordInput.value = ''; state.authenticated = true; await restoreRoute({ replace: true });
  } catch (error) { loginMessage.textContent = error.message; }
});

const statusLabel = game => game.lineupStatus === 'available' ? 'スタメン取得済み' : 'スタメン未発表または取得不完全';
async function loadGames() {
  showView('games');
  const grid = document.getElementById('games-grid');
  grid.innerHTML = '<p class="loading-message">MLB公式データを取得しています…</p>';
  try { state.games = (await api(`/api/games?date=${encodeURIComponent(jstDateString())}`)).games; renderGames(); }
  catch (error) { grid.innerHTML = `<p class="error-message">${escapeHtml(error.message)}</p>`; }
}

function renderGames() {
  const grid = document.getElementById('games-grid'); grid.innerHTML = '';
  if (!state.games.length) { grid.innerHTML = '<p class="loading-message">日本時間の本日のMLB試合はありません。</p>'; return; }
  state.games.forEach(game => {
    const card = document.createElement('article');
    card.className = `game-card ${game.lineupStatus === 'available' ? '' : 'game-card-pending'}`;
    card.tabIndex = 0; card.setAttribute('role', 'button');
    card.innerHTML = `<div class="game-status">${escapeHtml(statusLabel(game))}</div>
      <div class="game-matchup"><div class="game-team"><div class="game-team-code">${escapeHtml(game.away.code)}</div><div class="game-team-name">${escapeHtml(game.away.name)}</div></div>
      <div class="game-at">@</div><div class="game-team"><div class="game-team-code">${escapeHtml(game.home.code)}</div><div class="game-team-name">${escapeHtml(game.home.name)}</div></div></div>
      <div class="game-footer"><div class="game-time">${escapeHtml(game.time)}</div><div class="game-venue">${escapeHtml(game.venue)}</div></div>`;
    const open = () => navigate(`#lineup/${game.gamePk}`);
    card.addEventListener('click', open); card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') open(); });
    grid.appendChild(card);
  });
}

async function openGame(gamePk) {
  showView('lineup'); document.getElementById('output-message').textContent = 'MLB公式データを取得しています…';
  try { state.currentGame = await api(`/api/games/${gamePk}`); renderGame(state.currentGame); }
  catch (error) { document.getElementById('output-message').textContent = error.message; }
}

function renderGame(game) {
  document.getElementById('match-title').textContent = `${game.away.code} @ ${game.home.code}`;
  document.getElementById('match-time').textContent = game.time; document.getElementById('match-venue').textContent = game.venue;
  for (const side of ['away', 'home']) {
    document.getElementById(`${side}-team-name`).textContent = game[side].name;
    document.getElementById(`${side}-team-code`).textContent = game[side].code;
    const starter = game[side].starter;
    document.getElementById(`${side}-starter-name`).textContent = starter?.name ?? 'TBD';
    document.getElementById(`${side}-starter-meta`).textContent = starter ? `${starter.jerseyNumber ? `#${starter.jerseyNumber} / ` : ''}${starter.throws ? `${starter.throws}HP` : ''}` : '';
    renderLineup(document.getElementById(`${side}-lineup-list`), game[side].lineup);
  }
  const ready = game.lineupStatus === 'available';
  document.getElementById('excel-output-button').disabled = !ready;
  document.querySelector('.output-label').textContent = ready ? 'LINEUP READY' : 'LINEUP PENDING';
  document.getElementById('output-message').textContent = ready ? '' : game.lineupMessage;
}

function renderLineup(container, lineup) {
  container.innerHTML = '';
  if (!lineup.length) { container.innerHTML = '<div class="lineup-unavailable">スタメン未発表または取得不完全</div>'; return; }
  lineup.forEach(player => {
    const row = document.createElement('div'); row.className = 'lineup-player';
    const nameContent = player.spotvFound
      ? `<div class="player-name-wrap"><div class="player-name">${escapeHtml(player.name)}</div></div>`
      : `<div class="player-name-wrap"><input class="player-name-input" data-player-id="${player.playerId}" data-original-name="${escapeHtml(player.name)}" value="${escapeHtml(player.name)}" aria-label="${escapeHtml(player.name)} のSPOTV表記"/><div class="player-warning">SPOTV表記未登録 / 編集可能</div></div>`;
    row.innerHTML = `<div class="batting-order">${player.battingOrder}</div><div class="position">${escapeHtml(player.position ?? '--')}</div>
      <div class="jersey-number">${player.jerseyNumber ? `#${escapeHtml(player.jerseyNumber)}` : '--'}</div>${nameContent}<div class="bats">${escapeHtml(player.bats ?? '--')}</div>`;
    const input = row.querySelector('.player-name-input');
    if (input) input.addEventListener('input', () => {
      row.querySelector('.player-warning').textContent = input.value.trim() && input.value.trim() !== input.dataset.originalName
        ? '手動確認済み / 今回のExcelにのみ適用' : 'SPOTV表記未登録 / 編集可能';
    });
    container.appendChild(row);
  });
}

function navigate(hash, { replace = false } = {}) {
  const target = hash || '#games';
  if (replace) history.replaceState({ route: target }, '', target); else history.pushState({ route: target }, '', target);
  restoreRoute();
}
async function restoreRoute({ replace = false } = {}) {
  if (!state.authenticated) return showView('login');
  const match = location.hash.match(/^#lineup\/(\d+)$/);
  if (match) return openGame(Number(match[1]));
  if (replace || location.hash !== '#games') history.replaceState({ route: '#games' }, '', '#games');
  return loadGames();
}
window.addEventListener('popstate', () => restoreRoute());
document.getElementById('back-to-games').addEventListener('click', () => navigate('#games'));

document.getElementById('excel-output-button').addEventListener('click', async () => {
  const message = document.getElementById('output-message'); const button = document.getElementById('excel-output-button');
  if (!state.currentGame || state.currentGame.lineupStatus !== 'available') return;
  const overrides = {};
  document.querySelectorAll('.player-name-input').forEach(input => { if (input.value.trim() !== input.dataset.originalName) overrides[input.dataset.playerId] = input.value.trim(); });
  button.disabled = true; message.textContent = 'Excelを生成しています…';
  try {
    const result = await api(`/api/games/${state.currentGame.gamePk}/excel`, { method: 'POST', body: JSON.stringify({ overrides }) });
    const link = document.createElement('a'); link.href = result.downloadUrl; link.download = result.filename; document.body.appendChild(link); link.click(); link.remove();
    message.textContent = `${result.filename} を生成しました。`;
  } catch (error) { message.textContent = error.message; }
  finally { button.disabled = false; }
});

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

(async () => {
  try { state.authenticated = (await api('/api/session')).authenticated; } catch { state.authenticated = false; }
  await restoreRoute({ replace: !location.hash });
})();
