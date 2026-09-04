import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { LINEUP_WRITE_ALLOWLIST } from './lib/template-lineup-input.mjs';
import { formulaMap, listZipEntries, rawCellMap, readCellValues, sharedStringsFromXlsx, unzipEntry } from './lib/ooxml-xlsx.mjs';

const [templatePath, outputPath, manifestPath, reportPath] = process.argv.slice(2);
if (!reportPath) throw new Error('usage: node scripts/validate-generated-lineup.mjs template output manifest report');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const zipPattern = entry => entry.replace(/([\[\]*?])/g, '\\$1');
const entriesBefore = listZipEntries(templatePath);
const entriesAfter = listZipEntries(outputPath);
const expectedEntries = entriesBefore.filter(entry => entry !== 'xl/calcChain.xml');
const sameEntries = expectedEntries.length === entriesAfter.length && expectedEntries.every((x, i) => x === entriesAfter[i]);
if (!sameEntries) throw new Error('ZIP entries/order changed beyond calcChain removal');
execFileSync('unzip', ['-tqq', outputPath]);
const changedEntries = [];
for (const entry of expectedEntries) {
  const before = execFileSync('unzip', ['-p', templatePath, zipPattern(entry)]);
  const after = execFileSync('unzip', ['-p', outputPath, zipPattern(entry)]);
  if (!before.equals(after)) changedEntries.push(entry);
}
const allowedChangedEntries = new Set([
  '[Content_Types].xml', 'xl/_rels/workbook.xml.rels', 'xl/workbook.xml',
  ...Array.from({ length: 6 }, (_, index) => `xl/worksheets/sheet${index + 1}.xml`),
]);
if (changedEntries.some(entry => !allowedChangedEntries.has(entry))) throw new Error(`Unexpected changed OOXML parts: ${changedEntries.join(', ')}`);
const sheetBefore = unzipEntry(templatePath, 'xl/worksheets/sheet1.xml');
const sheetAfter = unzipEntry(outputPath, 'xl/worksheets/sheet1.xml');
const cellsBefore = rawCellMap(sheetBefore);
const cellsAfter = rawCellMap(sheetAfter);
const allCellRefs = [...new Set([...cellsBefore.keys(), ...cellsAfter.keys()])].sort();
const changedCells = allCellRefs.filter(ref => cellsBefore.get(ref) !== cellsAfter.get(ref));
const allowed = [...LINEUP_WRITE_ALLOWLIST].sort();
const formulaBefore = formulaMap(sheetBefore);
const formulaAfter = formulaMap(sheetAfter);
if (changedCells.some(ref => !LINEUP_WRITE_ALLOWLIST.has(ref) && !formulaBefore.has(ref))) {
  throw new Error(`Changed cells differ from allowlist: ${changedCells.join(', ')}`);
}
const formulaXml = raw => raw.match(/<f(?:\s[^>]*)?>[\s\S]*?<\/f>/)?.[0];
if (formulaBefore.size !== formulaAfter.size || [...formulaBefore].some(([ref, raw]) => formulaXml(formulaAfter.get(ref)) !== formulaXml(raw))) {
  throw new Error('Formula cells in スタメン changed');
}
let formulaCountBefore = 0, formulaCountAfter = 0;
const crossSheetReferenceCounts = {};
const formulaCachedValueCounts = {};
const stripCells = xml => xml.replace(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g, '');
for (let number = 1; number <= 6; number++) {
  const entry = `xl/worksheets/sheet${number}.xml`;
  const before = unzipEntry(templatePath, entry);
  const after = unzipEntry(outputPath, entry);
  const formulasBeforeForSheet = formulaMap(before);
  const formulasAfterForSheet = formulaMap(after);
  formulaCountBefore += formulasBeforeForSheet.size;
  formulaCountAfter += formulasAfterForSheet.size;
  if (formulasBeforeForSheet.size !== formulasAfterForSheet.size || [...formulasBeforeForSheet].some(([ref, raw]) => formulaXml(formulasAfterForSheet.get(ref)) !== formulaXml(raw))) {
    throw new Error(`Formula content changed in ${entry}`);
  }
  if (stripCells(before) !== stripCells(after)) throw new Error(`Worksheet structure outside cells changed in ${entry}`);
  crossSheetReferenceCounts[entry] = [...after.matchAll(/<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/g)].filter(x => x[1].includes('スタメン!')).length;
  formulaCachedValueCounts[entry] = [...rawCellMap(after).values()].filter(raw => /<f(?:\s|>)/.test(raw) && /<v(?:\s|\/|>)/.test(raw)).length;
}
if (formulaCountBefore !== 285 || formulaCountAfter !== 285) throw new Error(`Formula count mismatch: ${formulaCountBefore}/${formulaCountAfter}`);
if (formulaCachedValueCounts['xl/worksheets/sheet1.xml'] !== 36
  || Object.entries(formulaCachedValueCounts).some(([entry, count]) => entry !== 'xl/worksheets/sheet1.xml' && count !== 0)) {
  throw new Error(`Unexpected formula cached values: ${JSON.stringify(formulaCachedValueCounts)}`);
}
const sheet1CachedValuesVerified = [];
for (let row = 6; row <= 14; row++) {
  for (const [sourceColumn, positionColumn, batColumn] of [['O', 'C', 'F'], ['P', 'I', 'L']]) {
    const source = String(manifest.inputValues[`${sourceColumn}${row}`] ?? '');
    const parsed = source.match(/\(([^()]*)\)\s+(\S+)\s*$/);
    if (!parsed) throw new Error(`Cannot derive expected formula cache from ${sourceColumn}${row}`);
    for (const [reference, expected] of [[`${positionColumn}${row}`, parsed[2]], [`${batColumn}${row}`, parsed[1]]]) {
      const raw = rawCellMap(sheetAfter).get(reference) ?? '';
      const actual = raw.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (actual !== expected) throw new Error(`${reference}: expected cached value ${expected}, got ${actual}`);
      sheet1CachedValuesVerified.push(reference);
    }
  }
}
const workbookXml = unzipEntry(outputPath, 'xl/workbook.xml');
const workbookXmlBefore = unzipEntry(templatePath, 'xl/workbook.xml');
const expectedCalcPr = '<calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>';
if (!workbookXml.includes(expectedCalcPr)) throw new Error('Full recalculation calcPr settings missing');
if (workbookXmlBefore.replace(/<calcPr\b[^>]*\/>/, '') !== workbookXml.replace(/<calcPr\b[^>]*\/>/, '')) {
  throw new Error('workbook.xml changed outside calcPr');
}
if (entriesAfter.includes('xl/calcChain.xml')) throw new Error('Stale calcChain.xml remains');
const values = readCellValues(sheetAfter, sharedStringsFromXlsx(outputPath));
for (const [ref, expected] of Object.entries(manifest.inputValues)) {
  const actual = values.get(ref) ?? '';
  if (String(actual) !== String(expected ?? '')) throw new Error(`${ref}: expected ${expected}, got ${actual}`);
}
for (const cell of LINEUP_WRITE_ALLOWLIST) if (formulaAfter.has(cell)) throw new Error(`Allowlist contains formula cell: ${cell}`);
const report = {
  templatePath, outputPath,
  templateSha256: sha256(await fs.readFile(templatePath)), outputSha256: sha256(await fs.readFile(outputPath)),
  zipValid: true, zipEntryCount: entriesAfter.length, zipEntriesAndOrderPreservedExceptCalcChain: true,
  changedEntries, changedCells, changedCellCount: changedCells.length, allowedCellCount: allowed.length,
  onlyAllowedInputsAndFormulaCachesChanged: true, nonTargetNonFormulaCellXmlIdentical: true,
  formulaCountBefore, formulaCountAfter, formulasIdentical: true,
  formulaCachedValueCounts, sheet1CachedValuesVerified, calcPr: expectedCalcPr, calcChainRemoved: true,
  workbookXmlIdentical: !changedEntries.includes('xl/workbook.xml'),
  stylesIdentical: !changedEntries.includes('xl/styles.xml'),
  drawingsIdentical: !changedEntries.some(x => x.startsWith('xl/drawings/')),
  imagesIdentical: !changedEntries.some(x => x.startsWith('xl/media/')),
  printerSettingsIdentical: !changedEntries.some(x => x.startsWith('xl/printerSettings/')),
  worksheetStructuresIdenticalOutsideCells: true,
  crossSheetReferenceCounts,
  directInputValuesVerified: true,
};
await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
