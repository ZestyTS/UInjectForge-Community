import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateRegistry, validateReport } from '../site/registry.mjs';
import { validateStableFeed } from '../site/release.mjs';
import { parseReleaseCatalog, publishedReleaseCatalog } from '../site/release-catalog.mjs';
import { resolve } from 'node:path';
const root = new URL('../', import.meta.url);
const args = process.argv.slice(2);
let site = new URL('site/', root), publicStage = false;
if (args[0] === '--site-root') {
  if (!args[1] || args.length !== 2) throw new Error('Use --site-root path.');
  site = pathToFileURL(resolve(args[1]) + '/'); publicStage = true;
} else if (args.length > 1) throw new Error('Use one report path or --site-root path.');
if (args[0] && !publicStage) {
  const bytes = await readFile(args[0]);
  if (bytes.length > 65536) throw new Error('Report exceeds 64 KiB.');
  validateReport(JSON.parse(bytes));
  console.log('Compatibility report matches the public schema.');
}
validateRegistry(JSON.parse(await readFile(new URL('data/reports.json', site), 'utf8')));
const feed = JSON.parse(await readFile(new URL('updates/stable.json', site), 'utf8'));
validateStableFeed(feed);
const catalog = parseReleaseCatalog(await readFile(new URL('updates/releases.json', site), 'utf8'));
if (publicStage && publishedReleaseCatalog(catalog, feed.version).length !== catalog.length)
  throw new Error('The public catalog contains undated or unadvertised releases.');
console.log(`Public data validated: ${fileURLToPath(root)}`);
if ((await readFile(new URL('site/registry.mjs',root),'utf8')) !== (await readFile(new URL('service/registry.mjs',root),'utf8'))) throw new Error('Public and service report validators must match.');
