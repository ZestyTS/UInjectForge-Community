import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogLimits, parseReleaseCatalog, validateReleaseCatalog, publishedReleaseCatalog,
  announcementArtifacts } from '../site/release-catalog.mjs';
import { stagePublicSite } from '../tools/stage-public-site.mjs';
import { exportReleaseCatalog, exportAnnouncement } from '../tools/export-release-catalog.mjs';
import { downloadUrl, validateStableFeed } from '../site/release.mjs';

const release = (version = '1.0.5', date = '2026-09-01') => ({ version, date,
  sections: [{ title: 'Improvements', items: ['A specific improvement.'] }] });
const feed = { schemaVersion: 1, version: '1.0.5', downloadUrl };

test('shared catalog accepts optional owner narrative and preserves the authored data', () => {
  const catalog = [{ ...release('1.1.0', null), title: 'A personal update', announcementMarkdown: 'Hello everyone!\n\nThanks for waiting.' }, release()];
  const raw = JSON.stringify(catalog);
  assert.deepEqual(parseReleaseCatalog(raw), catalog);
  assert.deepEqual(publishedReleaseCatalog(catalog, '1.0.5'), [catalog[1]]);
  assert.equal(JSON.stringify(catalog), raw);
});

test('public catalog excludes both undated drafts and dated releases above advertised stable', () => {
  const catalog = [release('1.2.0'), release('1.1.0', null), release(), release('1.0.4')];
  assert.deepEqual(publishedReleaseCatalog(catalog, '1.0.5').map(entry => entry.version), ['1.0.5', '1.0.4']);
  assert.deepEqual(publishedReleaseCatalog([release('1.1.0', null)], '1.1.0'), []);
});

test('shared schema rejects duplicate keys and versions, noncanonical versions, malformed dates and unknown fields', () => {
  assert.throws(() => parseReleaseCatalog('[{"version":"1.0.5","version":"1.0.5","date":null,"sections":[]}]'), /Duplicate/);
  for (const version of ['v1.0.5', '1.0.5-beta', '1.0.5+build', '01.0.5', '1.0.5.0', '2147483648.0.0'])
    assert.throws(() => validateReleaseCatalog([release(version)]));
  for (const date of ['2026-02-30', '2026-2-01', '0000-01-01', '2026-09-01T00:00:00Z'])
    assert.throws(() => validateReleaseCatalog([release('1.0.5', date)]));
  assert.throws(() => validateReleaseCatalog([release(), release()]));
  assert.throws(() => validateReleaseCatalog([{ ...release(), html: '<script>bad</script>' }]));
  assert.throws(() => validateReleaseCatalog([{ ...release(), title: ' title ' }]));
  assert.throws(() => validateReleaseCatalog([{ ...release(), sections: [] }]));
  assert.throws(() => validateReleaseCatalog([{ ...release(), sections: [{ title: 'Fixes', items: [] }] }]));
});

test('shared catalog enforces byte, depth, string and count limits before rendering', () => {
  assert.throws(() => parseReleaseCatalog(' '.repeat(catalogLimits.bytes + 1)), /256 KiB/);
  assert.throws(() => parseReleaseCatalog('['.repeat(9) + '0' + ']'.repeat(9)), /depth/);
  assert.throws(() => validateReleaseCatalog([{ ...release(), announcementMarkdown: 'x'.repeat(catalogLimits.announcement + 1) }]));
  assert.throws(() => validateReleaseCatalog([{ ...release(), sections: [{ title: 'Fixes', items: ['bad\u0000text'] }] }]));
  assert.throws(() => validateReleaseCatalog(Array.from({ length: 65 }, (_, index) => release('1.0.' + index))));
  assert.throws(() => validateReleaseCatalog([{ ...release(), sections: Array.from({ length: 17 }, () => release().sections[0]) }]));
  assert.throws(() => validateReleaseCatalog([{ ...release(), sections: [{ title: 'Fixes', items: Array(129).fill('Fix.') }] }]));
  const many = Array.from({ length: 17 }, (_, index) => ({ ...release('1.0.' + index),
    sections: [{ title: 'Fixes', items: Array(128).fill('Fix.') }] }));
  assert.throws(() => validateReleaseCatalog(many), /Too many/);
});

test('announcement handoff uses the selected owner narrative then every TLDR section and escapes raw HTML', () => {
  const entry = { ...release('1.1.0', null), title: 'My update',
    announcementMarkdown: '# Hello\n\nI used `<widget>`. [Community](https://example.test/community)\n\n<script>alert(1)</script>\n\n[No](javascript:alert(1)) [No credentials](https://user:pass@example.test/)' };
  entry.sections[0].items.push('<img src=x onerror=alert(1)>');
  const raw = JSON.stringify(entry), generated = announcementArtifacts(entry);
  assert.equal(generated.title, 'My update');
  assert.ok(generated.markdown.startsWith('# Hello\n\nI used '));
  assert.ok(generated.markdown.indexOf('## TL;DR') > generated.markdown.indexOf('# Hello'));
  assert.ok(generated.markdown.includes('- &lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!generated.markdown.includes('<script>') && !generated.markdown.includes('<img'));
  assert.ok(generated.html.includes('<h1>Hello</h1>'));
  assert.ok(generated.html.includes('<code>&lt;widget&gt;</code>'));
  assert.ok(generated.html.includes('href="https://example.test/community"'));
  assert.ok(generated.html.includes('rel="noopener noreferrer"'));
  assert.ok(!generated.html.includes('<script>') && !generated.html.includes('<img'));
  assert.ok(!generated.html.includes('href="javascript:') && !generated.html.includes('href="https://user:'));
  assert.equal(JSON.stringify(entry), raw);
});

test('public stage writes filtered release bytes and preserves both authored catalog and baseline feed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'uif-release-catalog-'));
  try {
    const source = join(root, 'author'), output = join(root, 'public'), catalog = [release('1.1.0', null), release()];
    await mkdir(join(source, 'updates'), { recursive: true });
    const authorBytes = JSON.stringify(catalog), baselineBytes = JSON.stringify(feed);
    await writeFile(join(source, 'updates/releases.json'), authorBytes);
    await writeFile(join(source, 'updates/stable.json'), baselineBytes);
    await writeFile(join(source, 'index.html'), 'Synthetic public page');
    await stagePublicSite({ source, output, catalog, feed });
    assert.deepEqual(parseReleaseCatalog(await readFile(join(output, 'updates/releases.json'), 'utf8')), [catalog[1]]);
    assert.deepEqual(validateStableFeed(JSON.parse(await readFile(join(output, 'updates/stable.json'), 'utf8'))), feed);
    assert.equal(await readFile(join(source, 'updates/releases.json'), 'utf8'), authorBytes);
    assert.equal(await readFile(join(source, 'updates/stable.json'), 'utf8'), baselineBytes);
    await assert.rejects(() => stagePublicSite({ source, output, catalog, feed }), /EEXIST/);
    await assert.rejects(() => stagePublicSite({ source, output: join(source, 'bad'), catalog, feed }), /outside/);
    await assert.rejects(() => stagePublicSite({ source, output: join(root, 'bad'), catalog,
      feed: { ...feed, version: '1.1.0' } }), /dated catalog/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('public exporter filters into a fresh output while local announcement preview can select an undated draft', async () => {
  const root = await mkdtemp(join(tmpdir(), 'uif-release-export-'));
  try {
    const input = join(root, 'author.json'), output = join(root, 'export/releases.json');
    const catalog = [{ ...release('1.1.0', null), title: 'An owner update', announcementMarkdown: 'A personal story.' }, release()];
    const raw = JSON.stringify(catalog); await writeFile(input, raw);
    await exportReleaseCatalog({ input, output, stableVersion: '1.0.5' });
    assert.deepEqual(parseReleaseCatalog(await readFile(output, 'utf8')), [catalog[1]]);
    await assert.rejects(() => exportReleaseCatalog({ input, output: input, stableVersion: '1.0.5' }), /Never overwrite/);
    const handoff = join(root, 'announcement');
    await exportAnnouncement({ input, outputDirectory: handoff, version: '1.1.0' });
    assert.equal(await readFile(join(handoff, 'title.txt'), 'utf8'), 'An owner update\n');
    assert.ok((await readFile(join(handoff, 'announcement.md'), 'utf8')).startsWith('A personal story.'));
    assert.equal(await readFile(input, 'utf8'), raw);
    await assert.rejects(() => exportAnnouncement({ input, outputDirectory: handoff, version: '1.1.0' }), /EEXIST/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
