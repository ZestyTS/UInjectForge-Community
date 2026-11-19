import { readdir, mkdir, copyFile, writeFile, readFile, lstat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parseReleaseCatalog, publishedReleaseCatalog } from '../site/release-catalog.mjs';
import { validateStableFeed } from '../site/release.mjs';

export async function stagePublicSite({ source, output, catalog, feed }) {
  source = resolve(source); output = resolve(output);
  const within = relative(source, output);
  if (!within || (!within.startsWith('..' + sep) && within !== '..'))
    throw new Error('Public staging must be outside the authored site.');
  validateStableFeed(feed);
  const published = publishedReleaseCatalog(catalog, feed.version);
  if (!published.some(entry => entry.version === feed.version))
    throw new Error('The advertised stable release needs a dated catalog entry before publication.');
  const serialized = JSON.stringify(published, null, 2) + '\n';
  parseReleaseCatalog(serialized);
  const mobile = {};
  for (const audience of ['ios', 'android']) {
    const path = join(source, 'updates/releases-' + audience + '.json');
    let entries;
    try {
      const node = await lstat(path);
      if (!node.isFile() || node.isSymbolicLink() || node.size > 262144)
        throw new Error('Invalid mobile release catalog file.');
      entries = parseReleaseCatalog(await readFile(path, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      entries = []; // Older authored sites have no mobile catalog yet.
    }
    // Mobile store dates are independent of desktop's stable update feed.
    mobile[audience] = entries.filter(entry => entry.date !== null);
    parseReleaseCatalog(JSON.stringify(mobile[audience]));
  }

  await mkdir(dirname(output), { recursive: true });
  await mkdir(output); // A fresh stage prevents stale released or draft files surviving.
  async function copy(directory, destination, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error('Linked public site input refused.');
      if (entry.isDirectory()) {
        await mkdir(join(destination, entry.name));
        await copy(join(directory, entry.name), join(destination, entry.name), name + '/');
      } else if (entry.isFile()) {
        if (!['updates/releases.json', 'updates/stable.json', 'updates/releases-ios.json', 'updates/releases-android.json'].includes(name))
          await copyFile(join(directory, entry.name), join(destination, entry.name));
      } else throw new Error('Only ordinary public site files can be staged.');
    }
  }
  await copy(source, output);
  await mkdir(join(output, 'updates'), { recursive: true });
  await writeFile(join(output, 'updates/releases.json'), serialized, { flag: 'wx' });
  await writeFile(join(output, 'updates/stable.json'), JSON.stringify(feed, null, 2) + '\n', { flag: 'wx' });
  for (const audience of ['ios', 'android'])
    await writeFile(join(output, 'updates/releases-' + audience + '.json'),
      JSON.stringify(mobile[audience], null, 2) + '\n', { flag: 'wx' });
  return published;
}
