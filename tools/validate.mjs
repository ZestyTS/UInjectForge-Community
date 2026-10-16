import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateRegistry, validateReport } from '../site/registry.mjs';
const root = new URL('../', import.meta.url);
if (process.argv[2]) {
  const bytes = await readFile(process.argv[2]);
  if (bytes.length > 65536) throw new Error('Report exceeds 64 KiB.');
  validateReport(JSON.parse(bytes));
  console.log('Compatibility report matches the public schema.');
}
validateRegistry(JSON.parse(await readFile(new URL('site/data/reports.json', root), 'utf8')));
const feed = JSON.parse(await readFile(new URL('site/updates/stable.json', root), 'utf8'));
if (feed.schemaVersion !== 1 || !/^\d+\.\d+\.\d+$/.test(feed.version) || feed.downloadUrl !== 'https://zestyts.itch.io/uinjectforge') throw new Error('Invalid stable feed.');
console.log(`Public data validated: ${fileURLToPath(root)}`);
if ((await readFile(new URL('site/registry.mjs',root),'utf8')) !== (await readFile(new URL('service/registry.mjs',root),'utf8'))) throw new Error('Public and service report validators must match.');
