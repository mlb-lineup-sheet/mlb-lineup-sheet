import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const outputDir = args.shift() ?? 'private/cache/mlb';
const seasons = args.length ? args.map(Number) : [new Date().getUTCFullYear() - 2, new Date().getUTCFullYear() - 1, new Date().getUTCFullYear()];
await fs.mkdir(outputDir, { recursive: true });
for (const season of seasons) {
  const output = path.join(outputDir, `players-${season}.json`);
  try {
    await fs.access(output);
    console.log(JSON.stringify({ season, output, reused: true }));
    continue;
  } catch {}
  const url = `https://statsapi.mlb.com/api/v1/sports/1/players?season=${season}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`MLB players ${season}: HTTP ${response.status}`);
  const payload = await response.json();
  payload.season = season;
  await fs.writeFile(output, JSON.stringify(payload, null, 2) + '\n');
  console.log(JSON.stringify({ season, output, playerCount: payload.people?.length ?? 0, reused: false }));
}

