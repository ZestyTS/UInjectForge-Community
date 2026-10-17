const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:4176/';
const output = process.env.QA_OUTPUT || 'outputs/browser-qa';
const service = 'https://uif-community-reports.freepig18.chatgpt.site';
const challenge = '1760000000000.' + 'a'.repeat(32) + '.' + 'b'.repeat(64);
const cors = { 'Access-Control-Allow-Origin': '*' };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function manual(page) {
  await page.locator('#entry-mode [value=manual]').check();
  await page.locator('#game-name').fill('Manual test fixture');
  await page.locator('#report-system').selectOption('Nds');
  await page.locator('#uif-version').fill('1.0.6-test');
  await page.locator('#base-name').fill('Fixture base');
  await page.locator('#report-runtime').fill('Fixture runtime');
  await page.locator('[name=result][value=Issues]').check();
  await page.locator('#check-boot').selectOption('Pass');
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const { report } = await import('../tests/fixtures.mjs');
  const { intakeEnabled } = await import('../site/config.mjs');
  const list = { schemaVersion: 1, reports: Array.from({ length: 63 }, (_, i) => {
    const r = report(); r.reportId = i.toString(16).padStart(32, '0'); r.gameName = 'Authored Game ' + String(i).padStart(3, '0');
    r.console = i % 2 ? 'Gcn' : 'Nds'; r.reportedAtUtc = new Date(Date.UTC(2026, 9, 16) - i * 86400000).toISOString();
    r.outcome = ['Works', 'Issues', 'Broken'][i % 3]; r.notes = '<img src=x onerror=alert(1)> Fixture text, not markup.';
    return { report: r, review: { reviewer: 'Authored fixture', reviewedAtUtc: '2026-10-16T00:00:00Z', issueUrl: '' } };
  }) };
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const width of [1440, 1024, 768, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let registry = { schemaVersion: 1, reports: [] }, posts = [], receiptState = 'pending', releaseChallenge;
      await page.route('**/config.mjs', r => r.fulfill({ contentType: 'text/javascript', body: "export const intakeOrigin='" + service + "';export const intakeEnabled=true;" }));
      await page.route('**/api/reports*', r => r.fulfill({ json: registry, headers: cors }));
      await page.route('**/api/receipts/*', r => r.fulfill({ json: { status: receiptState }, headers: cors }));
      await page.goto(base); await page.locator('#empty').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#stats').isVisible(), false);
      await page.screenshot({ path: path.join(output, 'empty-' + width + '.png'), fullPage: true });
      registry = list; await page.reload(); await page.locator('#rows tr').first().waitFor();
      assert.equal(await page.locator('#rows tr').count(), 25); assert.equal(await page.locator('#total').innerText(), '63');
      await page.locator('#next-page').click(); assert.equal(await page.locator('#page-number').innerText(), 'Page 2 of 3');
      assert.ok(page.url().includes('page=2')); await page.reload();
      await page.waitForFunction(() => document.getElementById('page-number').textContent === 'Page 2 of 3');
      await page.locator('#next-page').click(); assert.equal(await page.locator('#rows tr').count(), 13);
      const allDownload = page.waitForEvent('download'); await page.locator('#download').click();
      const allResults = JSON.parse(fs.readFileSync(await (await allDownload).path(), 'utf8'));
      assert.equal(allResults.reports.length, 63);
      await page.locator('#sort').selectOption('game'); assert.equal(await page.locator('#page-number').innerText(), 'Page 1 of 3');
      await page.locator('#search').fill('Authored Game 062'); assert.equal(await page.locator('#rows tr').count(), 1);
      const filteredDownload = page.waitForEvent('download'); await page.locator('#download').click();
      const filteredResults = JSON.parse(fs.readFileSync(await (await filteredDownload).path(), 'utf8'));
      assert.equal(filteredResults.reports.length, 1); assert.equal(filteredResults.reports[0].report.gameName, 'Authored Game 062');
      await page.locator('#share-view').click();
      const shared = await page.evaluate(() => navigator.clipboard.readText()); assert.match(shared, /search=Authored/);
      await page.goto(base + new URL(shared).hash); await page.locator('#rows tr').first().waitFor();
      assert.equal(await page.locator('#search').inputValue(), 'Authored Game 062'); assert.equal(await page.locator('#rows tr').count(), 1);
      await page.locator('#filters button[type=reset]').click(); await page.locator('#environment').selectOption('Aroma');
      await page.locator('#rows button').first().click(); await page.locator('#detail').waitFor();
      assert.match(await page.locator('#detail-notes').innerText(), /<img/); assert.equal(await page.locator('#detail-notes img').count(), 0);
      await page.locator('#copy-report-link').click(); const link = await page.evaluate(() => navigator.clipboard.readText());
      assert.match(link, /#report\/[a-f0-9]{32}$/);
      await page.keyboard.press('Escape'); await page.waitForFunction(() => location.hash.includes('environment=Aroma'));
      assert.equal(await page.locator('#environment').inputValue(), 'Aroma');
      assert.ok(page.url().includes('environment=Aroma')); await page.goto(base + new URL(link).hash); await page.locator('#detail').waitFor();
      await page.keyboard.press('Escape');
      const wrappedButtons = await page.locator('#rows button').evaluateAll(buttons => buttons.filter(button => {
        const range = document.createRange(); range.selectNodeContents(button);
        return range.getClientRects().length > 1 || button.scrollWidth > button.clientWidth;
      }).length);
      assert.equal(wrappedButtons, 0);
      await page.screenshot({ path: path.join(output, 'reports-dark-' + width + '.png'), fullPage: true });
      await page.locator('#theme').click(); await page.reload();
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
      await page.locator('#rows tr').first().waitFor();
      await page.screenshot({ path: path.join(output, 'reports-light-' + width + '.png'), fullPage: true }); await page.locator('#theme').click();

      await page.locator('#nav-submit').click(); assert.equal(await page.locator('#report-fields').isVisible(), false);
      await page.locator('#skip-content').focus(); await page.keyboard.press('Enter');
      assert.ok(page.url().endsWith('#submit')); assert.equal(await page.locator('#main').evaluate(e => e === document.activeElement), true);
      await manual(page); assert.equal(await page.locator('#report-environment').inputValue(), 'Unknown');
      await page.locator('#report-environment').selectOption('Aroma');
      await page.locator('#additional-details').click(); await page.locator('#report-output').selectOption('Loadiine');
      await page.locator('#game-id').fill('Manual-game-id'); await page.locator('#preview-details').click();
      assert.match(await page.locator('#preview').innerText(), /Manually entered test report/);
      const saved = page.waitForEvent('download'); await page.locator('#export').click();
      const exported = JSON.parse(fs.readFileSync(await (await saved).path(), 'utf8'));
      assert.equal(exported.outputMode, 'Loadiine'); assert.equal(exported.gameId, 'Manual-game-id'); assert.deepEqual(exported.evidence.fingerprints, {});
      await page.locator('#consent').check(); await page.locator('#notes').fill('Changed after consent');
      assert.equal(await page.locator('#consent').isChecked(), false);
      await page.route('**/api/challenge', async r => {
        await new Promise(resolve => { releaseChallenge = resolve; });
        try { await r.fulfill({ json: { challenge }, headers: cors }); } catch {}
      });
      await page.route('**/api/submissions', r => {
        if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
        posts.push(r.request().postDataJSON());
        return r.fulfill({ status: 202, json: { receipt: 'b'.repeat(32), duplicate: false }, headers: cors });
      });
      await page.locator('#consent').check(); await page.locator('#send').click();
      // Wait on the route latch so slow verification stays observable without racing a request event.
      for (let i = 0; !releaseChallenge && i < 100; i++) await pause(10);
      assert.equal(await page.locator('#notes').isDisabled(), true); assert.equal(await page.locator('#report-file').isDisabled(), true);
      assert.equal(await page.locator('#entry-mode input').first().isDisabled(), true); assert.equal(await page.locator('#stop-waiting').isVisible(), true);
      releaseChallenge(); releaseChallenge = null;
      await page.locator('#receipt-panel').waitFor({ state: 'visible' });
      assert.equal(posts.length, 1); assert.equal(posts[0].report.notes, 'Changed after consent'); assert.equal(posts[0].report.outputMode, 'Loadiine');
      assert.equal(await page.locator('#notes').isDisabled(), false);
      assert.equal(await page.locator('#submission').isVisible(), false); assert.equal(await page.locator('#entry-mode').isVisible(), false);
      await page.locator('#copy-receipt').click(); const receiptLink = await page.evaluate(() => navigator.clipboard.readText());
      assert.match(receiptLink, /#status\?receipt=b{32}$/);
      const receiptFile = page.waitForEvent('download'); await page.locator('#save-receipt').click();
      const receipt = JSON.parse(fs.readFileSync(await (await receiptFile).path(), 'utf8')); assert.equal(receipt.receipt, 'b'.repeat(32)); assert.ok(!receipt.gameName);
      await page.screenshot({ path: path.join(output, 'submitted-' + width + '.png'), fullPage: true });
      await page.locator('#receipt-link').click(); await page.locator('#status-result').waitFor();
      assert.equal(await page.locator('#status-result-heading').innerText(), 'Awaiting review');
      receiptState = 'approved'; await page.locator('#refresh-status').click();
      await page.waitForFunction(() => document.getElementById('status-result-heading').textContent === 'Published');
      await page.locator('#receipt-input').fill('123456'); await page.locator('#lookup-status').click();
      assert.match(await page.locator('#lookup-message').innerText(), /32-character/); assert.equal(await page.locator('#lookup-status').isDisabled(), false);
      await page.locator('#receipt-input').fill(receiptLink); await page.locator('#lookup-status').click(); await page.locator('#status-result').waitFor();
      await page.screenshot({ path: path.join(output, 'status-' + width + '.png'), fullPage: true });
      if (width === 1440) {
        receiptState = 'rejected'; await page.locator('#refresh-status').click();
        await page.waitForFunction(() => document.getElementById('status-result-heading').textContent === 'Not published or removed');
        await page.route('**/api/receipts/*', r => r.fulfill({ status: 404, json: { error: 'Authored missing receipt' }, headers: cors }));
        await page.locator('#refresh-status').click();
        await page.waitForFunction(() => document.getElementById('lookup-message').textContent.includes('not found or expired'));
        assert.equal(await page.locator('#status-result').isVisible(), false);
        await page.route('**/api/receipts/*', r => r.fulfill({ status: 503, json: { error: 'Authored outage' }, headers: cors }));
        await page.locator('#lookup-status').click();
        await page.waitForFunction(() => document.getElementById('lookup-message').textContent.includes('does not mean the report was rejected'));
      }

      await page.locator('#nav-submit').click(); await page.locator('#new-report').click();
      assert.equal(await page.locator('#game-name').inputValue(), ''); assert.equal(await page.locator('#receipt-panel').isVisible(), true);
      assert.equal(await page.locator('#receipt-heading').innerText(), 'Previous submission'); assert.equal(await page.locator('#entry-mode').isVisible(), true);
      await page.locator('#entry-mode [value=import]').check();
      await page.locator('#report-file').setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(report())) });
      await page.waitForFunction(() => document.getElementById('game-name').disabled);
      assert.equal(await page.locator('#game-name').inputValue(), 'Authored test fixture');
      assert.match(await page.locator('#preview').innerText(), /RuntimeSha256/);
      assert.equal(await page.locator('#report-output').isDisabled(), true);
      page.once('dialog', dialog => dialog.accept()); await page.locator('#clear-import').click();
      assert.equal(await page.locator('#report-fields').isVisible(), false);
      if (width === 1440) {
        await manual(page); await page.locator('#consent').check(); await page.locator('#send').click();
        for (let i = 0; !releaseChallenge && i < 100; i++) await pause(10);
        await page.locator('#stop-waiting').click(); await page.waitForFunction(() => document.getElementById('submission').getAttribute('aria-busy') === 'false');
        assert.match(await page.locator('#submission-status').innerText(), /No report was sent/); assert.equal(posts.length, 1);
        assert.equal(await page.locator('#game-name').inputValue(), 'Manual test fixture');
        if (releaseChallenge) releaseChallenge(); releaseChallenge = null;
        await page.unroute('**/api/challenge');
        await page.route('**/api/challenge', r => r.fulfill({ json: { challenge }, headers: cors }));
        let releasePost;
        await page.route('**/api/submissions', async r => {
          if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
          posts.push(r.request().postDataJSON());
          await new Promise(resolve => { releasePost = resolve; });
          try { await r.fulfill({ status: 202, json: { receipt: 'c'.repeat(32), duplicate: false }, headers: cors }); } catch {}
        });
        await page.locator('#send').click();
        for (let i = 0; !releasePost && i < 1000; i++) await pause(10);
        assert.ok(releasePost, 'POST route should be reached'); await page.locator('#stop-waiting').click();
        await page.waitForFunction(() => document.getElementById('submission').getAttribute('aria-busy') === 'false');
        assert.match(await page.locator('#submission-status').innerText(), /may have arrived/); assert.equal(posts.length, 2);
        assert.equal(await page.locator('#notes').isDisabled(), false); releasePost();
      }
      const broken = await page.locator('img').evaluateAll(images => images.filter(img => !img.complete || !img.naturalWidth).map(img => img.src));
      assert.deepEqual(broken, []); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.deepEqual(errors, []);
      await context.close(); console.log('Usability browser QA passed at ' + width + 'px');
    }
    const real = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await real.newPage(), writes = [];
    if (intakeEnabled && base.startsWith('http://127.0.0.1:')) await page.route('**/api/reports*', r => r.fulfill({ json: { schemaVersion: 1, reports: [] }, headers: cors }));
    page.on('request', r => { if (r.url().includes('/api/submissions')) writes.push(r.url()); });
    await page.goto(base); await page.waitForFunction(() => document.getElementById('count').textContent !== 'Loading reports...');
    assert.equal(await page.locator('#load-error').isVisible(), false);
    await page.locator('#nav-submit').click(); await page.locator('#entry-mode [value=manual]').check();
    assert.equal(await page.locator('#send').isDisabled(), !intakeEnabled); assert.deepEqual(writes, []);
    await page.locator('#nav-reports').click();
    await page.route('**/data/reports.json', r => r.fulfill({ status: 503, json: { error: 'Authored outage' } }));
    if (intakeEnabled) await page.route('**/api/reports*', r => r.fulfill({ status: 503, json: { error: 'Authored outage' }, headers: cors }));
    await page.reload(); await page.waitForFunction(() => document.getElementById('count').textContent === 'Reports unavailable');
    await page.locator('#search').fill('anything'); assert.equal(await page.locator('#count').innerText(), 'Reports unavailable');
    assert.equal(await page.locator('#empty').isVisible(), false); assert.equal(await page.locator('#download').isDisabled(), true);
    await page.unroute('**/data/reports.json'); await page.unroute('**/api/reports*');
    await page.route('**/api/reports*', r => r.fulfill({ json: { schemaVersion: 1, reports: [] }, headers: cors }));
    await page.locator('#retry-load').click(); await page.waitForFunction(() => document.getElementById('load-error').hidden);
    assert.equal(await page.locator('#load-error').isVisible(), false); assert.equal(await page.locator('#count').innerText(), '0 reports');
    await real.close(); console.log('Actual intake state, no automatic upload, outage and retry checks passed');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
