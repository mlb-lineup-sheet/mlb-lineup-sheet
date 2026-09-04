import { execFileSync } from 'node:child_process';

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

function unzipText(file, entry) {
  return execFileSync('unzip', ['-p', file, entry], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}

function decodeXml(value) {
  return String(value ?? '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function sharedStrings(xml) {
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(([, body]) =>
    [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(([, text]) => decodeXml(text)).join('')
  );
}

function excelDate(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^\d+(?:\.\d+)?$/.test(raw) && Number(raw) > 20000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(raw)) * 86400000);
    return date.toISOString().slice(0, 10);
  }
  const match = raw.match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function parseRelationships(xml) {
  return new Map([...xml.matchAll(/<Relationship\b([^>]+)\/?\s*>/g)].map(([, attrs]) => {
    const id = attrs.match(/\bId="([^"]+)"/)?.[1];
    const target = attrs.match(/\bTarget="([^"]+)"/)?.[1];
    return [id, target];
  }).filter(([id, target]) => id && target));
}

function parseCells(xml, strings) {
  const rows = new Map();
  for (const match of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = match[1];
    const body = match[2] ?? '';
    const ref = attrs.match(/\br="([A-Z]+)(\d+)"/)?.slice(1);
    if (!ref) continue;
    const type = attrs.match(/\bt="([^"]+)"/)?.[1];
    const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '';
    let value = decodeXml(raw);
    if (type === 's' && value !== '') value = strings[Number(value)] ?? '';
    if (type === 'inlineStr') value = [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x => decodeXml(x[1])).join('');
    const row = Number(ref[1]);
    if (!rows.has(row)) rows.set(row, {});
    rows.get(row)[ref[0]] = value;
  }
  return rows;
}

export function parseSpotvWorkbook(file) {
  const workbook = unzipText(file, 'xl/workbook.xml');
  if (!workbook.includes(MAIN_NS)) throw new Error('Unsupported workbook XML namespace');
  const relationships = parseRelationships(unzipText(file, 'xl/_rels/workbook.xml.rels'));
  const strings = sharedStrings(unzipText(file, 'xl/sharedStrings.xml'));
  const sheets = [...workbook.matchAll(/<sheet\b([^>]+)\/?\s*>/g)].map(([, attrs]) => ({
    name: decodeXml(attrs.match(/\bname="([^"]+)"/)?.[1]),
    relationshipId: attrs.match(/\br:id="([^"]+)"/)?.[1],
  }));
  const players = [];
  const sheetSummaries = [];
  for (const sheet of sheets) {
    const target = relationships.get(sheet.relationshipId);
    if (!target) throw new Error(`Worksheet relationship missing: ${sheet.name}`);
    const rows = parseCells(unzipText(file, `xl/${target}`), strings);
    const headerRow = [...rows].find(([, row]) => String(row.A ?? '').includes('位置') && String(row.B ?? '').includes('背番号'))?.[0];
    if (!headerRow) throw new Error(`Player header not found: ${sheet.name}`);
    let count = 0;
    for (const [rowNumber, row] of [...rows].sort((a, b) => a[0] - b[0])) {
      if (rowNumber <= headerRow) continue;
      const officialName = String(row.D ?? '').trim();
      const spotvName = String(row.C ?? '').trim();
      if (!officialName && !spotvName) continue;
      const birthDate = excelDate(row.H);
      if (!officialName || !spotvName || !birthDate) {
        throw new Error(`${sheet.name}!${rowNumber}: required player field missing or invalid (${JSON.stringify({ spotvName, officialName, rawBirthDate: row.H, birthDate })})`);
      }
      players.push({
        sourceTeam: sheet.name, sourceRow: rowNumber,
        category: String(row.A ?? '').trim() || null,
        jerseyNumber: String(row.B ?? '').trim() || null,
        spotvName, officialName, batsThrows: String(row.E ?? '').trim() || null,
        birthDate, note: String(row.J ?? '').trim() || null,
      });
      count++;
    }
    sheetSummaries.push({
      team: sheet.name,
      teamName: String(rows.get(1)?.A ?? '').trim() || null,
      venueName: String(rows.get(2)?.B ?? '').trim() || null,
      playerCount: count,
    });
  }
  return { sheetCount: sheets.length, players, sheets: sheetSummaries };
}
