import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseReleaseCatalog, publishedReleaseCatalog, announcementArtifacts } from '../site/release-catalog.mjs';
import { validateStableFeed } from '../site/release.mjs';

export async function exportReleaseCatalog({ input, output, stableVersion }) {
  if (resolve(input) === resolve(output)) throw new Error('Never overwrite the authored release catalog.');
  const catalog = parseReleaseCatalog(await readFile(input, 'utf8'));
  const published = publishedReleaseCatalog(catalog, stableVersion);
  const serialized = JSON.stringify(published, null, 2) + '\n';
  parseReleaseCatalog(serialized);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, serialized, { flag: 'wx' });
  return published;
}

export async function exportAnnouncement({ input, outputDirectory, version }) {
  const catalog = parseReleaseCatalog(await readFile(input, 'utf8'));
  const entry = catalog.find(release => release.version === version);
  if (!entry) throw new Error('The selected release is absent from the catalog.');
  const artifacts = announcementArtifacts(entry);
  // Local review handoff only; this command never changes a date or stable feed.
  await mkdir(outputDirectory, { recursive: false });
  for (const [name, content] of [['title.txt', artifacts.title + '\n'], ['announcement.md', artifacts.markdown], ['announcement.html', artifacts.html]])
    await writeFile(resolve(outputDirectory, name), content, { flag: 'wx' });
  return artifacts;
}

async function main() {
  const options = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index], value = process.argv[index + 1];
    if (!['--input', '--output', '--feed', '--published-stable-version', '--announcement-version', '--announcement-output'].includes(key)
      || !value || Object.hasOwn(options, key)) throw new Error('Use unique named release export arguments.');
    options[key] = value;
  }
  if (!options['--input']) throw new Error('--input is required.');
  if (options['--announcement-version']) {
    if (!options['--announcement-output'] || options['--output'] || options['--published-stable-version'] || options['--feed'])
      throw new Error('Announcement handoff requires only input, announcement-version and a fresh announcement-output directory.');
    await exportAnnouncement({ input: resolve(options['--input']), version: options['--announcement-version'],
      outputDirectory: resolve(options['--announcement-output']) });
  } else {
    if (!options['--output'] || (!options['--feed'] && !options['--published-stable-version']))
      throw new Error('Catalog export requires output and an already-published stable version or feed.');
    const stableVersion = options['--published-stable-version']
      ?? validateStableFeed(JSON.parse(await readFile(options['--feed'], 'utf8'))).version;
    await exportReleaseCatalog({ input: resolve(options['--input']), output: resolve(options['--output']), stableVersion });
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
