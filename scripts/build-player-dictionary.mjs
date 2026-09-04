import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseSpotvWorkbook } from './lib/spotv-xlsx.mjs';
import { buildDictionary, dictionaryDiff, mergeMlbPeople } from './lib/player-dictionary.mjs';

function option(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const spotvPath = option('--spotv');
const mlbDir = option('--mlb-cache', 'private/cache/mlb');
const overridesPath = option('--overrides', 'private/dictionaries/manual-player-overrides.json');
const outputDir = option('--output-dir', 'private/dictionaries');
if (!spotvPath) throw new Error('required: --spotv /path/to/SPOTV読み表.xlsx');
const sourceBytes = await fs.readFile(spotvPath);
const sourceSha256 = crypto.createHash('sha256').update(sourceBytes).digest('hex');
const parsed = parseSpotvWorkbook(spotvPath);
const files = (await fs.readdir(mlbDir)).filter(x => /^players-\d{4}\.json$/.test(x)).sort();
if (!files.length) throw new Error(`No MLB cache files in ${mlbDir}`);
const payloads = await Promise.all(files.map(async file => {
  const value = JSON.parse(await fs.readFile(path.join(mlbDir, file), 'utf8'));
  value.season ??= Number(file.match(/\d{4}/)[0]);
  return value;
}));
let overrides = {};
try { overrides = JSON.parse(await fs.readFile(overridesPath, 'utf8')).overrides ?? {}; } catch (error) { if (error.code !== 'ENOENT') throw error; }
const people = mergeMlbPeople(payloads);
const result = buildDictionary(parsed.players, people, overrides);
await fs.mkdir(outputDir, { recursive: true });
const dictionaryPath = path.join(outputDir, 'spotv-player-dictionary.json');
const unresolvedPath = path.join(outputDir, 'unresolved-players.json');
let previous = {}, previousUnresolved = [];
try { previous = JSON.parse(await fs.readFile(dictionaryPath, 'utf8')).players ?? {}; } catch {}
try { previousUnresolved = JSON.parse(await fs.readFile(unresolvedPath, 'utf8')).players ?? []; } catch {}
const now = new Date().toISOString();
const dictionaryFile = {
  metadata: { generatedAt: now, sourceSha256, sourcePlayerCount: parsed.players.length, mlbUniquePlayerCount: people.length, seasons: payloads.map(x => x.season).sort(), autoConfirmedCount: result.resolvedRows.filter(x => x.status === 'auto-confirmed').length, manualConfirmedCount: result.resolvedRows.filter(x => x.status === 'manual-confirmed').length, unresolvedCount: result.unresolved.length },
  players: result.dictionary,
};
const unresolvedFile = { metadata: { generatedAt: now, sourceSha256 }, players: result.unresolved };
const diff = dictionaryDiff(previous, result.dictionary, previousUnresolved, result.unresolved);
await Promise.all([
  fs.writeFile(dictionaryPath, JSON.stringify(dictionaryFile, null, 2) + '\n'),
  fs.writeFile(unresolvedPath, JSON.stringify(unresolvedFile, null, 2) + '\n'),
  fs.writeFile(path.join(outputDir, 'dictionary-diff.json'), JSON.stringify({ generatedAt: now, ...diff }, null, 2) + '\n'),
  fs.writeFile(path.join(outputDir, 'spotv-source-summary.json'), JSON.stringify({ sourceSha256, sheetCount: parsed.sheetCount, playerCount: parsed.players.length, sheets: parsed.sheets }, null, 2) + '\n'),
]);
console.log(JSON.stringify(dictionaryFile.metadata));

