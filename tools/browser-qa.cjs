const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:4176/';
const output = process.env.QA_OUTPUT || 'outputs/browser-qa';
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const { report } = await import('../tests/fixtures.mjs');
  const fixture = { schemaVersion: 1, reports: [{ report: report(), review: { reviewer: 'Test fixture', reviewedAtUtc: '2026-10-16T00:00:00Z', issueUrl: '' } }] };
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const width of [1440, 768, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/config.mjs', route => route.fulfill({ contentType: 'text/javascript', body: "export const intakeOrigin='https://uif-community-reports.freepig18.chatgpt.site'; export const intakeEnabled=true;" }));
      await page.route('https://uif-community-reports.freepig18.chatgpt.site/api/reports', route => route.fulfill({ json: { schemaVersion: 1, reports: [] }, headers: { 'Access-Control-Allow-Origin': '*' } }));
      await page.goto(base); await page.locator('#empty').waitFor({ state: 'visible' });
      await page.screenshot({ path: path.join(output, 'empty-' + width + '.png'), fullPage: true });
      await page.unroute('**/api/reports');
      await page.route('**/api/reports', route => route.fulfill({ json: fixture, headers: { 'Access-Control-Allow-Origin': '*' } }));
      await page.reload(); await page.locator('#rows tr').waitFor();
      await page.locator('#search').fill('not a matching game'); assert.equal(await page.locator('#rows tr').count(), 0);
      await page.locator('button[type=reset]').click(); await page.locator('#rows tr').waitFor();
      await page.locator('#rows button').first().click(); await page.locator('#detail').waitFor();
      assert.match(await page.locator('#detail-checks').innerText(), /Not tested/); await page.keyboard.press('Escape');
      await page.locator('#theme').click(); assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
      await page.reload(); assert.equal(await page.locator('html').getAttribute('data-theme'), 'light'); await page.locator('#theme').click();
      await page.locator('#nav-submit').click(); await page.locator('#game-name').fill('Manual test fixture'); await page.locator('#report-system').selectOption('Nds');
      await page.locator('#uif-version').fill('1.0.6-test'); await page.locator('#base-name').fill('Fixture base'); await page.locator('#report-runtime').fill('Fixture runtime');
      await page.locator('[name=result][value=Issues]').check(); await page.locator('#check-boot').selectOption('Pass');
      await page.locator('#preview-details').click(); assert.match(await page.locator('#preview').innerText(), /Manually entered test report/);
      await page.locator('#consent').check(); assert.equal(await page.locator('#consent').isChecked(), true);
      await page.locator('#notes').fill('Changed after consent'); assert.equal(await page.locator('#consent').isChecked(), false);
      await page.route('**/api/challenge', route => route.fulfill({ json: { challenge: 'local-browser-fixture' }, headers: { 'Access-Control-Allow-Origin': '*' } }));
      let posted = null;
      await page.route('**/api/submissions', route => { if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } }); posted = route.request().postDataJSON(); return route.fulfill({ status: 202, json: { receipt: 'b'.repeat(32), duplicate: false }, headers: { 'Access-Control-Allow-Origin': '*' } }); });
      await page.locator('#consent').check(); await page.locator('#send').click(); await page.waitForFunction(() => document.getElementById('submission-status').textContent.includes('Received.'));
      assert.equal(posted.consent, true); assert.equal(posted.report.gameName, 'Manual test fixture'); assert.equal(posted.report.checks.boot, 'Pass');
      assert.match(await page.locator('#submission-status a').getAttribute('href'), /receipt\/b{32}$/);
      await page.screenshot({ path: path.join(output, 'submit-' + width + '.png'), fullPage: true });
      await page.locator('#report-file').setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(report())) });
      await page.waitForFunction(() => document.getElementById('game-name').disabled);
      assert.equal(await page.locator('#game-name').inputValue(), 'Authored test fixture'); assert.match(await page.locator('#preview').innerText(), /RuntimeSha256/);
      const brokenImages = await page.locator('img').evaluateAll(images => images.filter(img => !img.complete || img.naturalWidth === 0).map(img => img.src));
      assert.deepEqual(brokenImages, [], 'broken image assets');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, 'horizontal overflow at ' + width); assert.deepEqual(errors, []);
      await context.close(); console.log('Browser QA passed at ' + width + 'px');
    }
    const real = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const livePage = await real.newPage(), apiRequests=[];
    livePage.on('request',request=>{if(request.url().includes('freepig18.chatgpt.site/api/'))apiRequests.push(request.url());});
    await livePage.goto(base);await livePage.locator('#count').filter({hasText:'0 reports'}).waitFor();
    await livePage.locator('#nav-submit').click();assert.equal(await livePage.locator('#send').isDisabled(),true);
    assert.match(await livePage.locator('#submission-status').innerText(),/not enabled yet/);assert.deepEqual(apiRequests,[]);
    await livePage.screenshot({path:path.join(output,'actual-disabled-intake.png'),fullPage:true});await real.close();
    console.log('Actual disabled-intake UI passed without API requests');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
