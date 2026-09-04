import fs from 'node:fs/promises';
const [fixturePath, snapshotPath, outputPath] = process.argv.slice(2);
const fixture = JSON.parse(await fs.readFile(fixturePath,'utf8'));
const x = JSON.parse(await fs.readFile(snapshotPath,'utf8'));
const comparisons = [];
const add=(field,api,excel,comparable=true)=>comparisons.push({field,api,excel,comparable,match:comparable ? api===excel : null});
const easternKey = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(fixture.gameDate));
add('gameDateET', easternKey, x.easternDateKey);
add('venue', fixture.venue.name, x.venueEnglish);
add('awayTeam', fixture.away.name, x.awayEnglish);
add('homeTeam', fixture.home.name, x.homeEnglish);
for (const side of ['away','home']) {
  add(`${side}StartingPitcher`, fixture.actualStartingPitchers[side].fullName, x.startingPitchers[side].english);
  add(`${side}StartingPitcherJersey`, fixture.actualStartingPitchers[side].jerseyNumber, x.startingPitchers[side].jersey);
  fixture.startingLineups[side].forEach((p,i)=>{
    const e=x.lineups[side][i];
    add(`${side}.${i+1}.position`,p.position.abbreviation,e.position);
    add(`${side}.${i+1}.fullName`,p.fullName,e.fullName,false);
    add(`${side}.${i+1}.jersey`,p.jerseyNumber,e.jersey,false);
  });
}
const comparable=comparisons.filter(x=>x.comparable);
const matched=comparable.filter(x=>x.match);
const report={fixturePath,snapshotPath,comparableCount:comparable.length,matchedCount:matched.length,matchRate:Number((matched.length/comparable.length*100).toFixed(2)),comparisons};
await fs.writeFile(outputPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({matched:matched.length,comparable:comparable.length,matchRate:report.matchRate}));
