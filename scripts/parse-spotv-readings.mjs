import fs from 'node:fs/promises';
import path from 'node:path';
import { parseSpotvWorkbook } from './lib/spotv-xlsx.mjs';

const [input, output = 'private/cache/spotv-readings.json'] = process.argv.slice(2);
if (!input) throw new Error('usage: node scripts/parse-spotv-readings.mjs SPOTV読み表.xlsx [output.json]');
const parsed = parseSpotvWorkbook(input);
await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
await fs.writeFile(output, JSON.stringify(parsed, null, 2) + '\n');
console.log(JSON.stringify({ input, output, sheetCount: parsed.sheetCount, playerCount: parsed.players.length }));
