const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.WORKER_URL || 'https://uinjectforge-community-reports.i-wo.workers.dev';
const output = process.env.QA_OUTPUT || 'outputs/worker-browser-qa';

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const { report } = await import('../tests/fixtures.mjs');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const width of [1440, 768, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } }), page = await context.newPage(), errors = [], requests = [];
      page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push(request.url()));
      const response = await page.goto(origin + '/review'); assert.equal(response.status(), 200);
      await page.locator('#sign-in').waitFor({ state: 'visible' }); assert.equal(await page.locator('#review-controls').isVisible(), false);
      assert.equal(await page.locator('#sign-in a').getAttribute('href'), '/auth/login');
      await page.screenshot({ path: path.join(output, 'signed-out-' + width + '.png'), fullPage: true });
      assert.ok(!requests.some(url => url.includes('chatgpt') || url.includes('openai')));

      // Only the authenticated UI is mocked. No real moderation request is sent.
      const fixture = report(); fixture.gameName = 'Authored migration UI fixture'; fixture.notes = '<img src=x onerror=alert(1)> Plain text fixture.';
      const items = [{ receipt: 'd'.repeat(32), body: fixture, status: 'pending', created_at: Date.now() }], writes = [];
      await page.route('**/api/session', route => route.fulfill({ json: { reviewer: 'Authored test reviewer', csrf: 'a'.repeat(64) } }));
      await page.route('**/api/moderation*', route => {
        const request = route.request();
        if (request.method() === 'POST') {
          assert.equal(request.headers()['x-uif-csrf'], 'a'.repeat(64)); writes.push(request.postDataJSON());
          assert.equal(writes.at(-1).action, 'reject'); items[0].status = 'rejected'; items[0].body = null;
          return route.fulfill({ json: { ok: true } });
        }
        const status = new URL(request.url()).searchParams.get('status') || 'pending';
        return route.fulfill({ json: { submissions: items.filter(item => item.status === status), nextCursor: null } });
      });
      await page.route('**/auth/logout', route => route.fulfill({ status: 204 }));
      await page.reload(); await page.locator('.review-report').waitFor();
      assert.equal(await page.locator('.review-report img').count(), 0); assert.match(await page.locator('.review-report').innerText(), /<img/);
      assert.equal(await page.getByRole('button', { name: 'Approve and publish', exact: true }).count(), 1);
      await page.screenshot({ path: path.join(output, 'queue-' + width + '.png'), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Reject and erase contents', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('message').textContent === 'No submissions in this queue.'); assert.equal(writes.length, 1);
      await page.locator('#status').selectOption('rejected'); await page.locator('.review-report').waitFor();
      assert.equal(await page.locator('.review-report h2').innerText(), 'Removed submission'); assert.equal(await page.locator('.review-report pre').count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Approve and publish', exact: true }).count(), 0);
      await page.locator('#sign-out').click(); await page.locator('#sign-in').waitFor({ state: 'visible' });
      assert.equal(await page.locator('.review-report').count(), 0); assert.deepEqual(errors, []);
      const broken = await page.locator('img').evaluateAll(images => images.filter(image => !image.complete || !image.naturalWidth).map(image => image.src)); assert.deepEqual(broken, []);
      await context.close(); console.log('Cloudflare reviewer browser QA passed at ' + width + 'px (real anonymous; mocked private UI, zero real writes)');
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
