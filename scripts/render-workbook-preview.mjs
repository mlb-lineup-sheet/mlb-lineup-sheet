import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const [input, outputDir = '/private/tmp/spotv-workbook-preview'] = process.argv.slice(2);
if (!input) throw new Error('usage: node scripts/render-workbook-preview.mjs input.xlsx [outputDir]');
await fs.mkdir(outputDir, { recursive: true });
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(input));
const sheets = ['スタメン', '守備', '表', '裏', 'スタメン制作CG分', 'date'];
for (const sheetName of sheets) {
  const rendered = await workbook.render({ sheetName, autoCrop: 'all', scale: 1, format: 'png' });
  const bytes = new Uint8Array(await rendered.arrayBuffer());
  const output = path.join(outputDir, `${sheetName}.png`);
  await fs.writeFile(output, bytes);
  console.log(output);
}
