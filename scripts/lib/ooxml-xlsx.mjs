import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export function unzipEntry(file, entry) {
  const literalEntry = entry.replace(/([\[\]*?])/g, '\\$1');
  return execFileSync('unzip', ['-p', file, literalEntry], { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
}

export function listZipEntries(file) {
  return execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
}

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function replaceCell(xml, reference, value) {
  const pattern = new RegExp(`<c\\b([^>]*\\br="${reference}"[^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/c>)`);
  const match = xml.match(pattern);
  if (!match) throw new Error(`Template cell missing: ${reference}`);
  if (/<f(?:\s|>)/.test(match[0])) throw new Error(`Refusing to write formula cell: ${reference}`);
  let attrs = match[1].replace(/\s+t="[^"]*"/g, '').trimEnd();
  let replacement;
  if (value === null || value === undefined || value === '') {
    replacement = `<c${attrs}/>`;
  } else if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    replacement = `<c${attrs}><v>${Number(value)}</v></c>`;
  } else {
    const text = String(value);
    const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
    replacement = `<c${attrs} t="inlineStr"><is><t${space}>${escapeXml(text)}</t></is></c>`;
  }
  return xml.replace(pattern, replacement);
}

function removeFormulaCachedValues(xml) {
  let removed = 0;
  const updated = xml.replace(/<c\b([^>]*?)>([\s\S]*?)<\/c>/g, (cell, attrs, body) => {
    if (!/<f(?:\s|>)/.test(body)) return cell;
    const nextBody = body.replace(/<v(?:\s[^>]*)?\/>|<v(?:\s[^>]*)?>[\s\S]*?<\/v>/g, () => {
      removed += 1;
      return '';
    });
    return `<c${attrs}>${nextBody}</c>`;
  });
  return { xml: updated, removed };
}

function setFormulaCachedValue(xml, reference, value) {
  const pattern = new RegExp(`<c\\b([^>]*\\br="${reference}"[^>]*?)>([\\s\\S]*?)<\\/c>`);
  const match = xml.match(pattern);
  if (!match || !/<f(?:\s|>)/.test(match[2])) throw new Error(`Formula cell missing: ${reference}`);
  const bodyWithoutCache = match[2].replace(/<v(?:\s[^>]*)?\/>|<v(?:\s[^>]*)?>[\s\S]*?<\/v>/g, '');
  return xml.replace(pattern, `<c${match[1]}>${bodyWithoutCache}<v>${escapeXml(value)}</v></c>`);
}

function lineupFormulaCacheValues(values) {
  const caches = {};
  for (let row = 6; row <= 14; row++) {
    for (const [sourceColumn, positionColumn, batColumn] of [['O', 'C', 'F'], ['P', 'I', 'L']]) {
      const source = String(values[`${sourceColumn}${row}`] ?? '');
      const match = source.match(/\(([^()]*)\)\s+(\S+)\s*$/);
      if (!match) throw new Error(`${sourceColumn}${row}: cannot derive bat/position formula cache from ${source}`);
      caches[`${positionColumn}${row}`] = match[2];
      caches[`${batColumn}${row}`] = match[1];
    }
  }
  return caches;
}

function forceFullRecalculation(workbookXml) {
  const replacement = '<calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>';
  if (!/<calcPr\b[^>]*\/>/.test(workbookXml)) throw new Error('workbook.xml calcPr missing');
  return workbookXml.replace(/<calcPr\b[^>]*\/>/, replacement);
}

function removeCalcChainRelationship(xml) {
  const updated = xml.replace(/<Relationship\b[^>]*Type="[^"]*\/calcChain"[^>]*\/>/g, '');
  if (updated === xml) throw new Error('calcChain relationship missing');
  return updated;
}

function removeCalcChainContentType(xml) {
  const updated = xml.replace(/<Override\b[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/g, '');
  if (updated === xml) throw new Error('calcChain content type missing');
  return updated;
}

export function rawCellMap(xml) {
  return new Map([...xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map(match => {
    const ref = match[1].match(/\br="([A-Z]+\d+)"/)?.[1];
    return [ref, match[0]];
  }).filter(([ref]) => ref));
}

export function formulaMap(xml) {
  return new Map([...rawCellMap(xml)].filter(([, raw]) => /<f(?:\s|>)/.test(raw)));
}

function decodeXml(value) {
  return String(value ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

export function sharedStringsFromXlsx(file) {
  const xml = unzipEntry(file, 'xl/sharedStrings.xml');
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(([, body]) =>
    [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(([, text]) => decodeXml(text)).join('')
  );
}

export function readCellValues(xml, sharedStrings = []) {
  const values = new Map();
  for (const [ref, raw] of rawCellMap(xml)) {
    const type = raw.match(/\bt="([^"]+)"/)?.[1];
    let value;
    if (type === 'inlineStr') {
      value = [...raw.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x => decodeXml(x[1])).join('');
    } else {
      const stored = decodeXml(raw.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
      value = type === 's' && stored !== '' ? sharedStrings[Number(stored)] : stored;
    }
    values.set(ref, value ?? '');
  }
  return values;
}

export async function writeAllowedCells({ templatePath, outputPath, worksheetEntry = 'xl/worksheets/sheet1.xml', values, allowlist }) {
  const requested = Object.keys(values).sort();
  const allowed = [...allowlist].sort();
  const illegal = requested.filter(cell => !allowlist.has(cell));
  if (illegal.length) throw new Error(`Cells outside write allowlist: ${illegal.join(', ')}`);
  if (requested.length !== allowed.length || requested.some((cell, index) => cell !== allowed[index])) {
    throw new Error('The generated write set must exactly match the declared allowlist');
  }
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spotv-lineup-ooxml-'));
  try {
    let xml = unzipEntry(templatePath, worksheetEntry);
    for (const cell of requested) xml = replaceCell(xml, cell, values[cell]);
    const formulaCacheRemovals = {};
    const formulaCacheUpdates = {};
    const lineupCaches = lineupFormulaCacheValues(values);
    for (const [reference, value] of Object.entries(lineupCaches)) xml = setFormulaCachedValue(xml, reference, value);
    formulaCacheUpdates[worksheetEntry] = Object.keys(lineupCaches).length;
    for (let number = 1; number <= 6; number++) {
      const entry = `xl/worksheets/sheet${number}.xml`;
      const source = entry === worksheetEntry ? xml : unzipEntry(templatePath, entry);
      const cleaned = entry === worksheetEntry ? { xml: source, removed: 0 } : removeFormulaCachedValues(source);
      formulaCacheRemovals[entry] = cleaned.removed;
      const entryPath = path.join(tempDir, entry);
      await fs.mkdir(path.dirname(entryPath), { recursive: true });
      await fs.writeFile(entryPath, cleaned.xml);
    }
    const metadataEntries = {
      'xl/workbook.xml': forceFullRecalculation(unzipEntry(templatePath, 'xl/workbook.xml')),
      'xl/_rels/workbook.xml.rels': removeCalcChainRelationship(unzipEntry(templatePath, 'xl/_rels/workbook.xml.rels')),
      '[Content_Types].xml': removeCalcChainContentType(unzipEntry(templatePath, '[Content_Types].xml')),
    };
    for (const [entry, contents] of Object.entries(metadataEntries)) {
      const entryPath = path.join(tempDir, entry);
      await fs.mkdir(path.dirname(entryPath), { recursive: true });
      await fs.writeFile(entryPath, contents);
    }
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.copyFile(templatePath, outputPath);
    await exec('zip', ['-q', '-u', path.resolve(outputPath),
      '[Content_Types].xml', 'xl/_rels/workbook.xml.rels', 'xl/workbook.xml',
      ...Object.keys(formulaCacheRemovals)], { cwd: tempDir });
    if (listZipEntries(outputPath).includes('xl/calcChain.xml')) {
      await exec('zip', ['-q', '-d', path.resolve(outputPath), 'xl/calcChain.xml']);
    }
    return { formulaCacheRemovals, formulaCacheUpdates, calcChainRemoved: true };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
