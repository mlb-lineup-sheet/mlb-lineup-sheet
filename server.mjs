import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildGameFixture, easternDateString, findScheduledGame, gamesOnOfficialDate } from './scripts/lib/mlb-game.mjs';
import { resolveDisplayName, mergeMlbPeople } from './scripts/lib/player-dictionary.mjs';
import { spotvTeamCode } from './scripts/lib/mlb-team-map.mjs';
import { buildTemplateInput, LINEUP_WRITE_ALLOWLIST } from './scripts/lib/template-lineup-input.mjs';
import { writeAllowedCells } from './scripts/lib/ooxml-xlsx.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const loginAssetsDir = path.join(publicDir, 'assets', 'login');
const outputDir = process.env.SPOTV_OUTPUT_DIR ?? (process.env.NODE_ENV === 'production' ? path.join('/tmp', 'spotv-lineup-output') : path.join(root, 'outputs', 'web'));
const runtimeDir = process.env.SPOTV_RUNTIME_DIR ?? path.join(root, 'runtime');
const dictionaryPath = process.env.SPOTV_DICTIONARY_PATH ?? path.join(runtimeDir, 'spotv-player-dictionary.json');
const businessNamesPath = process.env.SPOTV_BUSINESS_NAMES_PATH ?? path.join(runtimeDir, 'spotv-business-names.json');
const mlbCacheDir = process.env.SPOTV_MLB_CACHE_DIR ?? path.join(root, 'private', 'cache', 'mlb');
const templatePath = process.env.SPOTV_TEMPLATE_PATH ?? path.join(runtimeDir, 'template.xlsx');
const password = process.env.SPOTV_LINEUP_PASSWORD;
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? '0.0.0.0';
const trustProxy = process.env.TRUST_PROXY === '1';
const secureCookies = process.env.NODE_ENV === 'production' || process.env.SECURE_COOKIES === '1';
const sessionIdleMs = 15 * 60 * 1000;
if (!password) throw new Error('SPOTV_LINEUP_PASSWORD is required');

const sessions = new Map();
const failedLogins = new Map();
const downloads = new Map();
const sourceCache = new Map();
const dictionary = JSON.parse(await fs.readFile(dictionaryPath, 'utf8')).players;
const spotvWorkbook = JSON.parse(await fs.readFile(businessNamesPath, 'utf8'));
const spotvVenueNames = new Map((spotvWorkbook.sheets ?? []).map(sheet => [sheet.team, sheet.venueName]));
const spotvTeamNames = new Map((spotvWorkbook.sheets ?? []).map(sheet => [sheet.team, sheet.teamName]));
let mlbPeople = [];
try {
  const cacheFiles = (await fs.readdir(mlbCacheDir)).filter(file => /^players-\d{4}\.json$/.test(file)).sort();
  mlbPeople = mergeMlbPeople(await Promise.all(cacheFiles.map(async file => {
    const payload = JSON.parse(await fs.readFile(path.join(mlbCacheDir, file), 'utf8'));
    payload.season ??= Number(file.match(/\d{4}/)[0]);
    return payload;
  })));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await fs.access(templatePath);

function baseHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}

function json(res, status, value, headers = {}) {
  res.writeHead(status, { ...baseHeaders(), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
}

function cookieMap(req) {
  return new Map((req.headers.cookie ?? '').split(';').map(item => item.trim().split('=').map(decodeURIComponent)).filter(parts => parts.length === 2));
}

function clientIp(req) {
  if (trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function session(req) {
  const token = cookieMap(req).get('spotv_session');
  const expiresAt = token && sessions.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  sessions.set(token, Date.now() + sessionIdleMs);
  return token;
}

async function bodyJson(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 64 * 1024) throw new Error('request body too large');
  }
  return text ? JSON.parse(text) : {};
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'SPOTV-Lineup-Generator/1.0' } });
  if (!response.ok) throw new Error(`MLB API HTTP ${response.status}`);
  return response.json();
}

async function gameSources(gamePk) {
  const key = String(gamePk);
  const cached = sourceCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const [schedule, live, box] = await Promise.all([
    fetchJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&gamePk=${gamePk}&hydrate=probablePitcher,team,venue`),
    fetchJson(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`),
    fetchJson(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`),
  ]);
  const scheduledGame = findScheduledGame(schedule, gamePk, live);
  if (!scheduledGame) throw new Error(`gamePk ${gamePk} not found`);
  const value = { schedule, live, box, scheduledGame, fixture: buildGameFixture({ scheduledGame, live, box }) };
  sourceCache.set(key, { expiresAt: Date.now() + 30_000, value });
  return value;
}

function formatJstTime(gameDate) {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(gameDate)) + ' JST';
}

function venueView(homeTeamId, officialName = '') {
  return spotvVenueNames.get(spotvTeamCode(homeTeamId)) || officialName;
}

function pitcherView(fixture, live, side) {
  const source = fixture.actualStartingPitchers?.[side] ?? fixture.probablePitchers?.[side];
  if (!source) return null;
  const official = live.gameData?.players?.[`ID${source.playerId}`] ?? mlbPeople.find(person => person.id === source.playerId) ?? {};
  const pitcher = {
    ...official, ...source,
    fullName: source.fullName ?? official.fullName,
    jerseyNumber: source.jerseyNumber ?? official.primaryNumber ?? null,
    pitchHand: source.pitchHand ?? official.pitchHand ?? null,
  };
  const conversion = resolveDisplayName(pitcher, dictionary);
  return { playerId: pitcher.playerId, name: conversion.displayName, jerseyNumber: pitcher.jerseyNumber, throws: pitcher.pitchHand?.code ?? null, spotvFound: conversion.spotvFound };
}

function lineupView(players) {
  return players.map(player => {
    const conversion = resolveDisplayName(player, dictionary);
    return {
      playerId: player.playerId, battingOrder: player.battingOrder,
      position: player.position.abbreviation, jerseyNumber: player.jerseyNumber,
      name: conversion.displayName, officialName: player.fullName,
      bats: player.batSide?.code ?? null, spotvFound: conversion.spotvFound,
    };
  });
}

function detailView(sources) {
  const { fixture, live } = sources;
  const awayCode = spotvTeamCode(fixture.away.id);
  const homeCode = spotvTeamCode(fixture.home.id);
  return {
    gamePk: fixture.gamePk, gameDate: fixture.gameDate, time: formatJstTime(fixture.gameDate),
    venue: venueView(fixture.home.id, fixture.venue.name), status: fixture.status, lineupStatus: fixture.lineupStatus,
    lineupMessage: fixture.lineupStatus === 'available' ? 'スタメン取得済み' : 'スタメン未発表または取得不完全',
    away: { ...fixture.away, code: awayCode, spotvName: spotvTeamNames.get(awayCode) ?? fixture.away.name, starter: pitcherView(fixture, live, 'away'), lineup: lineupView(fixture.startingLineups.away) },
    home: { ...fixture.home, code: homeCode, spotvName: spotvTeamNames.get(homeCode) ?? fixture.home.name, starter: pitcherView(fixture, live, 'home'), lineup: lineupView(fixture.startingLineups.home) },
  };
}

async function todayGames(date) {
  const schedule = await fetchJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${date}&endDate=${date}&hydrate=probablePitcher,team,venue`);
  const games = gamesOnOfficialDate(schedule, date);
  return Promise.all(games.map(async game => {
    try {
      const sources = await gameSources(game.gamePk);
      return detailView(sources);
    } catch (error) {
      return {
        gamePk: game.gamePk, gameDate: game.gameDate, time: formatJstTime(game.gameDate),
        venue: venueView(game.teams.home.team.id, game.venue?.name ?? ''),
        status: game.status, lineupStatus: 'incomplete', lineupMessage: 'スタメン未発表または取得不完全',
        away: { id: game.teams.away.team.id, code: spotvTeamCode(game.teams.away.team.id), name: game.teams.away.team.name },
        home: { id: game.teams.home.team.id, code: spotvTeamCode(game.teams.home.team.id), name: game.teams.home.team.name },
        detailError: error.message,
      };
    }
  }));
}

async function generateExcel(gamePk, overrides) {
  const sources = await gameSources(gamePk);
  if (sources.fixture.lineupStatus !== 'available') throw new Error('スタメン未発表または取得不完全');
  const safeOverrides = {};
  const fallbackIds = new Set([...sources.fixture.startingLineups.away, ...sources.fixture.startingLineups.home]
    .filter(player => !resolveDisplayName(player, dictionary).spotvFound).map(player => String(player.playerId)));
  for (const [playerId, name] of Object.entries(overrides ?? {})) {
    if (!fallbackIds.has(String(playerId))) throw new Error(`playerId ${playerId} is not an editable fallback`);
    const trimmed = String(name).trim();
    if (!trimmed || trimmed.length > 80) throw new Error(`invalid override for playerId ${playerId}`);
    safeOverrides[String(playerId)] = trimmed;
  }
  const input = buildTemplateInput({
    fixture: sources.fixture, dictionary, spotvWorkbook,
    mlbPeople: [...mlbPeople, ...Object.values(sources.live.gameData?.players ?? {})],
    displayNameOverrides: safeOverrides,
  });
  const gameOutputDir = path.join(outputDir, input.metadata.japanDate);
  const outputPath = path.join(gameOutputDir, input.filename);
  await writeAllowedCells({ templatePath, outputPath, values: input.values, allowlist: LINEUP_WRITE_ALLOWLIST });
  const token = crypto.randomBytes(24).toString('base64url');
  downloads.set(token, { path: outputPath, filename: input.filename, expiresAt: Date.now() + 30 * 60 * 1000 });
  return { token, filename: input.filename, downloadUrl: `/api/download/${token}` };
}

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const loginImageMime = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
async function serveLoginAsset(url, res) {
  const match = url.pathname.match(/^\/assets\/login\/([a-z0-9_-]+\.(?:webp|png|jpe?g))$/i);
  if (!match) return false;
  const file = path.join(loginAssetsDir, match[1]);
  try {
    const contents = await fs.readFile(file);
    res.writeHead(200, {
      ...baseHeaders(),
      'Content-Type': loginImageMime[path.extname(file).toLowerCase()],
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(contents);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    json(res, 404, { error: 'Not found' });
  }
  return true;
}
async function serveStatic(url, res) {
  const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (!['index.html', 'styles.css', 'app.js'].includes(relative)) return false;
  const file = path.join(publicDir, relative);
  res.writeHead(200, { ...baseHeaders(), 'Content-Type': mime[path.extname(file)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(await fs.readFile(file));
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? `${host}:${port}`}`);
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const ip = clientIp(req);
      const failures = failedLogins.get(ip) ?? { count: 0, lockedUntil: 0 };
      if (failures.lockedUntil > Date.now()) return json(res, 429, { error: 'しばらく待ってから再試行してください' });
      const supplied = String((await bodyJson(req)).password ?? '');
      const a = Buffer.from(supplied); const b = Buffer.from(password);
      const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
      if (!valid) {
        failures.count += 1;
        if (failures.count >= 5) { failures.count = 0; failures.lockedUntil = Date.now() + 5 * 60 * 1000; }
        failedLogins.set(ip, failures);
        return json(res, 401, { error: 'PASSWORDが正しくありません' });
      }
      failedLogins.delete(ip);
      const token = crypto.randomBytes(32).toString('base64url');
      sessions.set(token, Date.now() + sessionIdleMs);
      const secure = secureCookies ? '; Secure' : '';
      return json(res, 200, { ok: true }, { 'Set-Cookie': `spotv_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}` });
    }
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/api/session') return json(res, 200, { authenticated: Boolean(session(req)) });
    if (url.pathname.startsWith('/api/') && !session(req)) return json(res, 401, { error: '認証が必要です' });
    if (req.method === 'GET' && url.pathname === '/api/games') {
      const date = url.searchParams.get('date') ?? easternDateString();
      try { gamesOnOfficialDate({ dates: [] }, date); }
      catch { return json(res, 400, { error: 'dateは現地日付のYYYY-MM-DD形式で指定してください' }); }
      return json(res, 200, { date, games: await todayGames(date) });
    }
    const gameMatch = url.pathname.match(/^\/api\/games\/(\d+)$/);
    if (req.method === 'GET' && gameMatch) return json(res, 200, detailView(await gameSources(Number(gameMatch[1]))));
    const excelMatch = url.pathname.match(/^\/api\/games\/(\d+)\/excel$/);
    if (req.method === 'POST' && excelMatch) return json(res, 200, await generateExcel(Number(excelMatch[1]), (await bodyJson(req)).overrides));
    const downloadMatch = url.pathname.match(/^\/api\/download\/([A-Za-z0-9_-]+)$/);
    if (req.method === 'GET' && downloadMatch) {
      const item = downloads.get(downloadMatch[1]);
      if (!item || item.expiresAt < Date.now()) return json(res, 404, { error: 'ダウンロード期限が切れました' });
      res.writeHead(200, {
        ...baseHeaders(),
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(item.filename)}`,
        'Cache-Control': 'no-store',
      });
      return res.end(await fs.readFile(item.path));
    }
    if (req.method === 'GET' && await serveLoginAsset(url, res)) return;
    if (req.method === 'GET' && await serveStatic(url, res)) return;
    json(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    json(res, 500, { error: error.message || 'サーバーエラー' });
  }
});

server.listen(port, host, () => console.log(`SPOTV LINEUP GENERATOR: http://${host}:${port}`));
