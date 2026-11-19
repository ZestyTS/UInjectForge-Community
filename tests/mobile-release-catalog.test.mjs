import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stagePublicSite } from '../tools/stage-public-site.mjs';
import { parseReleaseCatalog } from '../site/release-catalog.mjs';
import { downloadUrl } from '../site/release.mjs';

const release = (version, date, text) => ({ version, date,
  sections: [{ title: 'Changes', items: [text] }] });
const desktop = release('1.1.0', '2026-11-13', 'Desktop history.');
const feed = { schemaVersion: 1, version: '1.1.0', downloadUrl };

async function authored(action) {
  const root = await mkdtemp(join(tmpdir(), 'uif-mobile-history-'));
  try {
    const source = join(root, 'author'), output = join(root, 'stage');
    await mkdir(join(source, 'updates'), { recursive: true });
    await writeFile(join(source, 'updates/releases.json'), JSON.stringify([desktop]));
    await writeFile(join(source, 'updates/stable.json'), JSON.stringify(feed));
    await action(source, output);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('stage filters undated mobile drafts and does not borrow desktop date or notes', async () => {
  await authored(async (source, output) => {
    const ios = [release('1.1.1', null, 'Unreleased iOS notes.')];
    const android = [release('1.1.1', '2026-11-20', 'Android notes.')];
    for (const [name, value] of [['ios', ios], ['android', android]])
      await writeFile(join(source, 'updates/releases-' + name + '.json'), JSON.stringify(value));
    await stagePublicSite({ source, output, catalog: [desktop], feed });
    assert.deepEqual(parseReleaseCatalog(await readFile(join(output, 'updates/releases-ios.json'), 'utf8')), []);
    assert.deepEqual(parseReleaseCatalog(await readFile(join(output, 'updates/releases-android.json'), 'utf8')), android);
    assert.deepEqual(parseReleaseCatalog(await readFile(join(output, 'updates/releases.json'), 'utf8')), [desktop]);
    assert.deepEqual(JSON.parse(await readFile(join(output, 'updates/stable.json'), 'utf8')), feed);
    assert.deepEqual(JSON.parse(await readFile(join(source, 'updates/releases-ios.json'), 'utf8')), ios);
  });
});

test('older sites without mobile catalogs keep desktop output and emit empty metadata feeds', async () => {
  await authored(async (source, output) => {
    await stagePublicSite({ source, output, catalog: [desktop], feed });
    for (const audience of ['ios', 'android'])
      assert.deepEqual(parseReleaseCatalog(await readFile(join(output, 'updates/releases-' + audience + '.json'), 'utf8')), []);
  });
});

test('invalid mobile catalog fails before stage creation instead of copying raw draft bytes', async () => {
  await authored(async (source, output) => {
    await writeFile(join(source, 'updates/releases-ios.json'), '[{"version":"1.1.0","date":null,"sections":[],"bad":true}]');
    await assert.rejects(() => stagePublicSite({ source, output, catalog: [desktop], feed }));
    await assert.rejects(() => readFile(join(output, 'updates/releases-ios.json')), /ENOENT/);
  });
});
