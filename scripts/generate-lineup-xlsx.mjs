import fs from 'node:fs/promises';
import path from 'node:path';
import { parseSpotvWorkbook } from './lib/spotv-xlsx.mjs';
import { mergeMlbPeople } from './lib/player-dictionary.mjs';
import { buildTemplateInput, LINEUP_WRITE_ALLOWLIST } from './lib/template-lineup-input.mjs';
import { writeAllowedCells } from './lib/ooxml-xlsx.mjs';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
let fixturePath = option('--fixture');
const gamePkOption = option('--game-pk');
const templatePath = option('--template');
const spotvPath = option('--spotv');
const dictionaryPath = option('--dictionary', 'private/dictionaries/spotv-player-dictionary.json');
const mlbCacheDir = option('--mlb-cache', 'private/cache/mlb');
const outputDir = option('--output-dir', 'outputs/integrated-lineup-test');
const outputSuffix = option('--output-suffix', '');
if (!fixturePath && gamePkOption) {
  const candidates = (await fs.readdir('tests/fixtures')).filter(x => x.endsWith('.json') && !x.includes('comparison'));
  for (const candidate of candidates) {
    const candidatePath = path.join('tests/fixtures', candidate);
    const value = JSON.parse(await fs.readFile(candidatePath, 'utf8'));
    if (value.gamePk === Number(gamePkOption)) { fixturePath = candidatePath; break; }
  }
}
if (!fixturePath || !templatePath || !spotvPath) {
  throw new Error('required: --game-pk GAME_PK (with a saved fixture) or --fixture fixture.json, plus --template and --spotv');
}
const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
if (gamePkOption && fixture.gamePk !== Number(gamePkOption)) throw new Error(`Fixture gamePk ${fixture.gamePk} does not match --game-pk ${gamePkOption}`);
const dictionary = JSON.parse(await fs.readFile(dictionaryPath, 'utf8')).players;
const spotvWorkbook = parseSpotvWorkbook(spotvPath);
const cacheFiles = (await fs.readdir(mlbCacheDir)).filter(x => /^players-\d{4}\.json$/.test(x)).sort();
const payloads = await Promise.all(cacheFiles.map(async file => {
  const payload = JSON.parse(await fs.readFile(path.join(mlbCacheDir, file), 'utf8'));
  payload.season ??= Number(file.match(/\d{4}/)[0]);
  return payload;
}));
const input = buildTemplateInput({ fixture, dictionary, spotvWorkbook, mlbPeople: mergeMlbPeople(payloads) });
const outputFilename = input.filename.replace(/\.xlsx$/, `${outputSuffix}.xlsx`);
const outputPath = path.resolve(outputDir, outputFilename);
const recalculation = await writeAllowedCells({ templatePath, outputPath, values: input.values, allowlist: LINEUP_WRITE_ALLOWLIST });
const manifestPath = path.resolve(outputDir, outputFilename.replace(/\.xlsx$/, '.manifest.json'));
await fs.writeFile(manifestPath, JSON.stringify({
  generatedAt: new Date().toISOString(), fixturePath, templatePath, spotvPath,
  outputPath, writeAllowlist: [...LINEUP_WRITE_ALLOWLIST].sort(), inputValues: input.values,
  ...input.metadata,
  recalculation,
}, null, 2) + '\n');
console.log(JSON.stringify({ gamePk: fixture.gamePk, outputPath, manifestPath, changedCellCount: LINEUP_WRITE_ALLOWLIST.size }));
