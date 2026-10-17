import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadUrl, compareVersions, validateStableFeed } from '../site/release.mjs';
import { generateFeed, generateCurrentFeed, latestReleaseUrl, servedFeedUrl } from '../tools/release-feed.mjs';

const baseline = { schemaVersion: 1, version: '1.0.5', downloadUrl };
const release = (version = '1.0.6') => ({ id: 123, tag_name: 'v' + version, draft: false, prerelease: false,
  published_at: '2026-10-16T00:00:00Z', html_url: 'https://github.com/ZestyTS/UInjectForge-Community/releases/tag/v' + version });

test('published release generates the lightweight feed without changing installer destination', () => {
  assert.deepEqual(generateFeed(release(), baseline), { ...baseline, version: '1.0.6' });
  assert.equal(generateFeed(release('1.0.10'), baseline).version, '1.0.10');
  assert.equal(compareVersions('1.0.10', '1.0.9'), 1);
});
test('no published release retains the initial stable baseline', () => {
  assert.deepEqual(generateFeed(null, baseline, baseline), baseline);
  assert.deepEqual(generateFeed(null, baseline), baseline);
});
for (const invalid of ['1.0.6-beta.1', '1.0.6+test', '01.0.6', '1.0', '1.0.6/other', '2147483648.0.0'])
  test('does not advertise unsupported stable version ' + invalid, () => assert.throws(() => generateFeed(release(invalid), baseline)));
test('drafts, prereleases, missing publication and foreign release URLs are rejected', () => {
  for (const change of [{ draft: true }, { prerelease: true }, { published_at: null }, { id: 0 },
    { html_url: 'https://evil.test/releases/tag/v1.0.6' }]) assert.throws(() => generateFeed({ ...release(), ...change }, baseline));
});
test('neither deleted announcements nor an older latest release silently roll back deployed versions', () => {
  const served = { ...baseline, version: '1.0.7' };
  assert.throws(() => generateFeed(release(), baseline, served), /roll back/);
  assert.throws(() => generateFeed(null, baseline, served), /roll back/);
  assert.throws(() => generateFeed(release('1.0.4'), baseline), /predates/);
  assert.equal(generateFeed(release('1.0.7'), baseline, served).version, '1.0.7');
});
test('feed validation refuses private/executable download URLs and extra fields', () => {
  for (const bad of [{ ...baseline, downloadUrl: 'https://example.test/app.exe' }, { ...baseline, token: 'not-public' }, [], null])
    assert.throws(() => validateStableFeed(bad));
});
test('GitHub credentials are sent only to GitHub, never the public Pages request', async () => {
  const calls = [];
  const result = await generateCurrentFeed({ baseline, token: 'authored-test-token', fetchImpl: async (url, options) => {
    calls.push({ url, ...options }); return Response.json(url === latestReleaseUrl ? release() : baseline);
  } });
  assert.equal(result.feed.version, '1.0.6'); assert.equal(result.evidence.releaseId, 123);
  assert.equal(calls[0].url, latestReleaseUrl); assert.equal(calls[0].headers.Authorization, 'Bearer authored-test-token');
  assert.equal(calls[1].url, servedFeedUrl); assert.equal(calls[1].headers.Authorization, undefined);
  assert.ok(calls.every(call => call.redirect === 'error'));
  assert.ok(!JSON.stringify(result.evidence).includes('authored-test-token'));
});
test('404 on the release endpoint is the only absent-release fallback', async () => {
  const result = await generateCurrentFeed({ baseline, fetchImpl: async url => url === latestReleaseUrl
    ? new Response('{}', { status: 404 }) : Response.json(baseline) });
  assert.deepEqual(result.feed, baseline);
  for (const status of [401, 403, 429, 500]) await assert.rejects(() => generateCurrentFeed({ baseline,
    fetchImpl: async () => new Response('{}', { status }) }), /HTTP/);
});
test('malformed, oversized and unavailable metadata fails before publishing a feed', async () => {
  await assert.rejects(() => generateCurrentFeed({ baseline, fetchImpl: async () => new Response('not json') }));
  await assert.rejects(() => generateCurrentFeed({ baseline, fetchImpl: async () => new Response(' '.repeat(262145)) }), /size limit/);
  await assert.rejects(() => generateCurrentFeed({ baseline, fetchImpl: async url => url === latestReleaseUrl
    ? Response.json(release()) : new Response('{}', { status: 503 }) }), /HTTP 503/);
});
test('release-triggered builds must observe the same latest stable announcement', async () => {
  await assert.rejects(() => generateCurrentFeed({ baseline, expectedReleaseId: 999,
    fetchImpl: async () => Response.json(release()) }), /latest stable release/);
  const result = await generateCurrentFeed({ baseline, expectedReleaseId: 123,
    fetchImpl: async url => Response.json(url === latestReleaseUrl ? release() : baseline) });
  assert.equal(result.feed.version, '1.0.6');
});
