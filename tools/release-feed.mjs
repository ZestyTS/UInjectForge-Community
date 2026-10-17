import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compareVersions, validateStableFeed, versionParts, downloadUrl } from '../site/release.mjs';

export const repository = 'ZestyTS/UInjectForge-Community';
export const latestReleaseUrl = 'https://api.github.com/repos/' + repository + '/releases/latest';
export const servedFeedUrl = 'https://zestyts.github.io/UInjectForge-Community/updates/stable.json';

export function generateFeed(release, baseline, served = null) {
  const initial = validateStableFeed(baseline);
  let version = initial.version;
  if (release !== null) {
    if (!release || release.draft !== false || release.prerelease !== false
      || !Number.isSafeInteger(release.id) || release.id < 1
      || typeof release.published_at !== 'string' || !Number.isFinite(Date.parse(release.published_at))
      || typeof release.tag_name !== 'string') throw new Error('Expected a published stable GitHub release.');
    version = release.tag_name.replace(/^v/, '');
    versionParts(version);
    if (release.html_url !== 'https://github.com/' + repository + '/releases/tag/' + release.tag_name)
      throw new Error('Release URL does not belong to the public community repository.');
    if (compareVersions(version, initial.version) < 0) throw new Error('Release predates the initial stable version.');
  }
  if (served && compareVersions(version, validateStableFeed(served).version) < 0)
    throw new Error('Refusing to roll back the deployed update feed. Restore the latest stable release and retry.');
  return { schemaVersion: 1, version, downloadUrl };
}

async function fetchJson(url, { fetchImpl, headers, limit, missing = false }) {
  const response = await fetchImpl(url, { headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000) });
  if (missing && response.status === 404) { await response.body?.cancel(); return null; }
  if (!response.ok) { await response.body?.cancel(); throw new Error('Release metadata request failed: HTTP ' + response.status); }
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel(); throw new Error('Release metadata exceeds its size limit.');
  }
  const reader = response.body.getReader(), chunks = []; let length = 0;
  while (true) {
    const part = await reader.read(); if (part.done) break;
    length += part.value.byteLength;
    if (length > limit) { await reader.cancel(); throw new Error('Release metadata exceeds its size limit.'); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function generateCurrentFeed({ baseline, fetchImpl = fetch, token = '', expectedReleaseId = null }) {
  const githubHeaders = { Accept: 'application/vnd.github+json', 'User-Agent': 'UInjectForge-Community-Release' };
  if (token) githubHeaders.Authorization = 'Bearer ' + token;
  const release = await fetchJson(latestReleaseUrl, { fetchImpl, headers: githubHeaders, limit: 262144, missing: true });
  if (expectedReleaseId !== null && (!Number.isSafeInteger(expectedReleaseId) || expectedReleaseId < 1 || release?.id !== expectedReleaseId))
    throw new Error('The published announcement is not the latest stable release yet. Check Set as latest release and retry.');
  const served = await fetchJson(servedFeedUrl, { fetchImpl, headers: { Accept: 'application/json' }, limit: 2048, missing: true });
  const feed = generateFeed(release, baseline, served);
  return { feed, evidence: { checkedAtUtc: new Date().toISOString(), source: release ? 'github-release' : 'initial-stable-baseline',
    version: feed.version, previousDeployedVersion: served?.version || null, releaseId: release?.id || null,
    releaseUrl: release?.html_url || null, publishedAtUtc: release?.published_at || null } };
}

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  let output = resolve(root, 'site/updates/stable.json'), evidence = resolve(root, 'outputs/release-generation.json');
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i + 1] || !['--output', '--evidence'].includes(args[i])) throw new Error('Use --output path and/or --evidence path.');
    if (args[i] === '--output') output = resolve(args[i + 1]); else evidence = resolve(args[i + 1]);
  }
  const baseline = JSON.parse(await readFile(resolve(root, 'site/updates/stable.json'), 'utf8'));
  const expectedReleaseId = process.env.EXPECTED_RELEASE_ID ? Number(process.env.EXPECTED_RELEASE_ID) : null;
  const result = await generateCurrentFeed({ baseline, token: process.env.GITHUB_TOKEN || '', expectedReleaseId });
  for (const [file, value] of [[output, result.feed], [evidence, result.evidence]]) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value, null, 2) + '\n');
  }
  console.log('Generated stable feed ' + result.feed.version + ' from ' + result.evidence.source + '. Installers remain on itch.io.');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
