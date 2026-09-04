import fs from 'node:fs/promises';
const paths = process.argv.slice(2);
if (!paths.length) throw new Error('pass one or more fixture paths');
for (const path of paths) {
  const f = JSON.parse(await fs.readFile(path, 'utf8'));
  const errors = [];
  if (!Number.isInteger(f.gamePk)) errors.push('gamePk missing');
  if (!f.away?.name || !f.home?.name) errors.push('teams missing');
  for (const side of ['away','home']) {
    const l = f.startingLineups?.[side] ?? [];
    if (l.length !== 9) errors.push(`${side}: lineup count ${l.length}`);
    if (new Set(l.map(x => x.battingOrder)).size !== 9 || l.some((x,i) => x.battingOrder !== i+1)) errors.push(`${side}: batting order invalid`);
    if (l.some(x => !x.playerId)) errors.push(`${side}: playerId missing`);
    if (l.some(x => !x.position?.abbreviation)) errors.push(`${side}: position missing`);
    if (l.some(x => x.sourceBattingOrderCode !== String(x.battingOrder*100))) errors.push(`${side}: substitute mixed into initial lineup`);
    if (!f.actualStartingPitchers?.[side]?.playerId) errors.push(`${side}: actual starter missing`);
    if (f.lineupAnnouncementEvidence?.[`${side}InitialSlots`]?.join(',') !== '100,200,300,400,500,600,700,800,900') errors.push(`${side}: initial slots incomplete`);
  }
  if (errors.length) throw new Error(`${path}: ${errors.join('; ')}`);
  console.log(`PASS ${path}`);
}
