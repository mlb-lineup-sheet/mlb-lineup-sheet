import fs from 'node:fs/promises';
import path from 'node:path';

const [date, gamePk, outputDir='raw'] = process.argv.slice(2);
if (!date || !gamePk) throw new Error('usage: fetch-game YYYY-MM-DD gamePk [outputDir]');
await fs.mkdir(outputDir,{recursive:true});
const urls={
  schedule:`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=probablePitcher,team,venue`,
  live:`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`,
  boxscore:`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`,
};
for (const [name,url] of Object.entries(urls)) {
  const response=await fetch(url);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  await fs.writeFile(path.join(outputDir,`${name}-${gamePk}.json`),await response.text());
}
console.log(JSON.stringify({date,gamePk:Number(gamePk),outputDir,urls},null,2));
