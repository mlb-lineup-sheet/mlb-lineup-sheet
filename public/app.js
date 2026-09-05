const views = { login: document.getElementById('login-view'), games: document.getElementById('games-view'), lineup: document.getElementById('lineup-view') };
const state = { authenticated: false, games: [], currentGame: null, selectedDate: null, lineupSnapshots: new Map(), lineupChanged: false };
const sessionIdleMs = 15 * 60 * 1000;
let sessionExpiryTimer;

function armSessionExpiry() {
  clearTimeout(sessionExpiryTimer);
  sessionExpiryTimer = setTimeout(() => {
    state.authenticated = false;
    showView('login');
  }, sessionIdleMs);
}

function showView(name) {
  Object.values(views).forEach(view => view.classList.remove('view-active'));
  views[name].classList.add('view-active');
  window.scrollTo(0, 0);
}

const jstFormat = options => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', ...options }).format(new Date());
function jstDateString() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const validDateString = value => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') && !Number.isNaN(new Date(`${value}T00:00:00Z`).valueOf());
function shiftDate(date, days) {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}
document.getElementById('header-date').textContent = jstFormat({ year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) } });
  const data = (response.headers.get('content-type') ?? '').includes('application/json') ? await response.json() : null;
  if (response.status === 401 && !['/api/login', '/api/session'].includes(url)) { state.authenticated = false; showView('login'); }
  if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
  if (state.authenticated) armSessionExpiry();
  return data;
}

const passwordInput = document.getElementById('password-input');
const loginMessage = document.getElementById('login-message');
const loginForm = document.getElementById('login-form');
const loginButton = loginForm.querySelector('button[type="submit"]');
const loginButtonLabel = loginButton.innerHTML;
const enablePasswordInput = () => { passwordInput.readOnly = false; };
passwordInput.addEventListener('pointerdown', enablePasswordInput);
passwordInput.addEventListener('focus', enablePasswordInput);
loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (loginButton.disabled) return;
  loginButton.disabled = true;
  loginButton.classList.add('is-loading');
  loginButton.textContent = 'ログイン中…';
  loginMessage.className = 'login-message login-message-loading';
  loginMessage.textContent = '認証しています。しばらくお待ちください…';
  const submittedPassword = passwordInput.value;
  passwordInput.value = '';
  passwordInput.readOnly = true;
  try {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password: submittedPassword }) });
    state.authenticated = true;
    armSessionExpiry();
    loginMessage.textContent = '試合情報を読み込んでいます…';
    await restoreRoute({ replace: true });
  } catch (error) {
    passwordInput.readOnly = false;
    loginMessage.className = 'login-message';
    loginMessage.textContent = error.message;
  } finally {
    loginButton.disabled = false;
    loginButton.classList.remove('is-loading');
    loginButton.innerHTML = loginButtonLabel;
    if (state.authenticated) loginMessage.textContent = '';
  }
});

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !state.authenticated) return;
  try {
    state.authenticated = (await api('/api/session')).authenticated;
  } catch {
    state.authenticated = false;
  }
  if (state.authenticated) armSessionExpiry();
  else showView('login');
});

const statusLabel = game => game.lineupStatus === 'available' ? 'スタメン情報取得済み' : 'スタメン未発表または取得不完全';
const teamLogoUrl = teamId => `https://www.mlbstatic.com/team-logos/${Number(teamId)}.svg`;
const headshotUrl = playerId => `https://img.mlbstatic.com/mlb-photos/image/upload/w_240,q_auto:best/v1/people/${Number(playerId)}/headshot/silo/current`;
const teamColors = Object.freeze({
  108: '#ba0021', 109: '#a71930', 110: '#df4601', 111: '#bd3039', 112: '#0e3386',
  113: '#c6011f', 114: '#e31937', 115: '#33006f', 116: '#0c2340', 117: '#002d62',
  118: '#004687', 119: '#005a9c', 120: '#ab0003', 121: '#ff5910', 133: '#003831',
  134: '#fdb827', 135: '#2f241d', 136: '#0c2c56', 137: '#fd5a1e', 138: '#c41e3a',
  139: '#092c5c', 140: '#003278', 141: '#134a8e', 142: '#002b5c', 143: '#e81828',
  144: '#ce1141', 145: '#27251f', 146: '#00a3e0', 147: '#003087', 158: '#ffc52f',
});
const teamColor = teamId => teamColors[Number(teamId)] ?? '#0b4f82';
function pitcherCard(starter, side) {
  const fallback = starter ? 'NO PHOTO' : 'TBD';
  const photo = starter?.playerId
    ? `<img class="game-pitcher-image" src="${headshotUrl(starter.playerId)}" alt="" loading="lazy"/>`
    : '';
  const name = starter
    ? `${starter.jerseyNumber ? `<span class="game-pitcher-jersey">${escapeHtml(starter.jerseyNumber)}</span>` : ''}${escapeHtml(starter.name)}`
    : 'TBD';
  const meta = starter ? (starter.throws ? `${starter.throws}HP` : '') : '予告先発未定';
  return `<div class="game-pitcher game-pitcher-${side}${starter ? '' : ' game-pitcher-no-starter'}">
    <div class="game-pitcher-photo${photo ? ' has-photo' : ''}">${photo}<span class="game-pitcher-fallback">${fallback}</span></div>
    <div class="game-pitcher-copy"><strong>${name}</strong><span>${escapeHtml(meta)}</span></div>
  </div>`;
}
const selectedDateInput = document.getElementById('selected-date');
const todayButton = document.getElementById('today-date');

async function loadGames(date = state.selectedDate ?? jstDateString()) {
  state.selectedDate = validDateString(date) ? date : jstDateString();
  selectedDateInput.value = state.selectedDate;
  todayButton.disabled = state.selectedDate === jstDateString();
  showView('games');
  const grid = document.getElementById('games-grid');
  grid.innerHTML = '<p class="loading-message">MLB公式データを取得しています…</p>';
  try { state.games = (await api(`/api/games?date=${encodeURIComponent(state.selectedDate)}`)).games; renderGames(); }
  catch (error) { grid.innerHTML = `<p class="error-message">${escapeHtml(error.message)}</p>`; }
}

function renderGames() {
  const grid = document.getElementById('games-grid'); grid.innerHTML = '';
  if (!state.games.length) { grid.innerHTML = `<p class="loading-message">日本時間 ${escapeHtml(state.selectedDate)} のMLB試合はありません。</p>`; return; }
  state.games.forEach(game => {
    const card = document.createElement('article');
    card.className = `game-card ${game.lineupStatus === 'available' ? '' : 'game-card-pending'}`;
    card.style.setProperty('--away-color', teamColor(game.away.id));
    card.style.setProperty('--home-color', teamColor(game.home.id));
    card.tabIndex = 0; card.setAttribute('role', 'button');
    const ready = game.lineupStatus === 'available';
    card.innerHTML = `<div class="game-card-accent" aria-hidden="true"><span></span><span></span></div>
      <div class="game-watermarks" aria-hidden="true"><img class="game-watermark" src="${teamLogoUrl(game.away.id)}" alt=""/><img class="game-watermark" src="${teamLogoUrl(game.home.id)}" alt=""/></div>
      <div class="game-card-top"><div class="game-status ${ready ? 'game-status-ready' : 'game-status-pending'}"><span></span>${escapeHtml(statusLabel(game))}</div></div>
      <div class="game-teams">
        <div class="game-team game-team-away"><img class="game-team-logo" src="${teamLogoUrl(game.away.id)}" alt="" loading="lazy"/><div class="game-team-code">${escapeHtml(game.away.code)}</div></div>
        <div class="game-versus" aria-hidden="true"></div>
        <div class="game-team game-team-home"><div class="game-team-code">${escapeHtml(game.home.code)}</div><img class="game-team-logo" src="${teamLogoUrl(game.home.id)}" alt="" loading="lazy"/></div>
      </div>
      <div class="game-pitching-duel">
        ${pitcherCard(game.away.starter, 'away')}
        <div class="duel-mark" aria-hidden="true">VS</div>
        ${pitcherCard(game.home.starter, 'home')}
      </div>
      <div class="game-footer"><div class="game-time">${escapeHtml(game.time)}</div><div class="game-venue">${escapeHtml(game.venue)}</div></div>`;
    card.querySelectorAll('.game-team-logo').forEach(logo => logo.addEventListener('error', () => { logo.hidden = true; }, { once: true }));
    card.querySelectorAll('.game-watermark').forEach(logo => logo.addEventListener('error', () => { logo.hidden = true; }, { once: true }));
    card.querySelectorAll('.game-pitcher-image').forEach(photo => photo.addEventListener('error', () => { photo.hidden = true; photo.closest('.game-pitcher-photo').classList.add('photo-missing'); }, { once: true }));
    const open = () => navigate(`#lineup/${game.gamePk}?date=${state.selectedDate}`);
    card.addEventListener('click', open); card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') open(); });
    grid.appendChild(card);
  });
}

async function openGame(gamePk) {
  showView('lineup'); document.getElementById('output-message').textContent = 'MLB公式データを取得しています…';
  try {
    const game = await api(`/api/games/${gamePk}`);
    const previous = state.lineupSnapshots.get(gamePk);
    const current = lineupSnapshot(game);
    state.lineupChanged = Boolean(previous?.ready && current.ready && previous.signature !== current.signature);
    state.lineupSnapshots.set(gamePk, current);
    state.currentGame = game;
    renderGame(game);
  }
  catch (error) { document.getElementById('output-message').textContent = error.message; }
}

function lineupSnapshot(game) {
  const snapshotSide = side => ({
    starterId: game[side].starter?.playerId ?? null,
    lineup: (game[side].lineup ?? []).map(player => ({
      playerId: player.playerId,
      battingOrder: player.battingOrder,
      position: player.position,
    })),
  });
  return {
    ready: game.lineupStatus === 'available',
    signature: JSON.stringify({ away: snapshotSide('away'), home: snapshotSide('home') }),
  };
}

function renderGame(game) {
  document.getElementById('match-time').textContent = game.time; document.getElementById('match-venue').textContent = game.venue;
  const hero = document.getElementById('matchup-hero');
  hero.style.setProperty('--away-color', teamColor(game.away.id));
  hero.style.setProperty('--home-color', teamColor(game.home.id));
  const ready = game.lineupStatus === 'available';
  const heroStatus = document.getElementById('matchup-status');
  heroStatus.className = `matchup-status ${ready ? 'game-status-ready' : 'game-status-pending'}`;
  heroStatus.innerHTML = `<span></span>${escapeHtml(statusLabel(game))}`;
  const changeAlert = document.getElementById('lineup-change-alert');
  changeAlert.hidden = !state.lineupChanged;
  changeAlert.classList.remove('is-acknowledged');
  for (const side of ['away', 'home']) {
    const logoUrl = teamLogoUrl(game[side].id);
    document.getElementById(`${side}-hero-code`).textContent = game[side].code;
    document.getElementById(`${side}-hero-name`).textContent = game[side].name;
    document.getElementById(`${side}-team-name`).textContent = game[side].spotvName ?? game[side].name;
    const board = document.querySelector(`.team-lineup:${side === 'away' ? 'first-child' : 'last-child'}`);
    board.style.setProperty('--team-color', teamColor(game[side].id));
    for (const id of [`${side}-hero-logo`, `${side}-hero-watermark`, `${side}-board-logo`, `${side}-board-watermark`]) {
      const image = document.getElementById(id);
      image.hidden = false; image.src = logoUrl;
      image.onerror = () => { image.hidden = true; };
    }
    const starter = game[side].starter;
    document.getElementById(`${side}-starter-name`).textContent = starter ? `${starter.jerseyNumber ? `${starter.jerseyNumber} ` : ''}${starter.name}` : 'TBD';
    document.getElementById(`${side}-starter-meta`).textContent = starter?.throws ? `${starter.throws}HP` : '';
    const starterPhoto = document.getElementById(`${side}-starter-photo`);
    starterPhoto.hidden = !starter?.playerId;
    if (starter?.playerId) {
      starterPhoto.src = headshotUrl(starter.playerId);
      starterPhoto.onerror = () => { starterPhoto.hidden = true; };
    }
    renderLineup(document.getElementById(`${side}-lineup-list`), game[side].lineup);
  }
  document.getElementById('excel-output-button').disabled = !ready;
  document.querySelector('.output-label').textContent = ready ? 'スタメン情報取得済み' : 'スタメン情報未取得';
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
    row.innerHTML = `<div class="batting-order">${escapeHtml(player.battingOrder)}</div>${nameContent}
      <div class="bats">(${escapeHtml(player.bats ?? '--')})</div><div class="position">${escapeHtml(player.position ?? '--')}</div><div class="jersey-number">${player.jerseyNumber ? escapeHtml(player.jerseyNumber) : '--'}</div>`;
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
  const lineupMatch = location.hash.match(/^#lineup\/(\d+)(?:\?date=(\d{4}-\d{2}-\d{2}))?$/);
  if (lineupMatch) {
    state.selectedDate = validDateString(lineupMatch[2]) ? lineupMatch[2] : jstDateString();
    return openGame(Number(lineupMatch[1]));
  }
  const gamesMatch = location.hash.match(/^#games(?:\/(\d{4}-\d{2}-\d{2}))?$/);
  const date = validDateString(gamesMatch?.[1]) ? gamesMatch[1] : jstDateString();
  const route = `#games/${date}`;
  if (replace || location.hash !== route) history.replaceState({ route, date }, '', route);
  return loadGames(date);
}
window.addEventListener('popstate', () => restoreRoute());
document.getElementById('back-to-games').addEventListener('click', () => navigate(`#games/${state.selectedDate ?? jstDateString()}`));
document.getElementById('previous-date').addEventListener('click', () => navigate(`#games/${shiftDate(state.selectedDate, -1)}`));
document.getElementById('next-date').addEventListener('click', () => navigate(`#games/${shiftDate(state.selectedDate, 1)}`));
todayButton.addEventListener('click', () => navigate(`#games/${jstDateString()}`));
selectedDateInput.addEventListener('change', () => {
  if (validDateString(selectedDateInput.value)) navigate(`#games/${selectedDateInput.value}`);
});

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
    document.getElementById('lineup-change-alert').classList.add('is-acknowledged');
  } catch (error) { message.textContent = error.message; }
  finally { button.disabled = false; }
});

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

(async () => {
  try { state.authenticated = (await api('/api/session')).authenticated; } catch { state.authenticated = false; }
  if (state.authenticated) armSessionExpiry();
  await restoreRoute({ replace: !location.hash });
})();
