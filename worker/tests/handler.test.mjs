import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createWorker } from '../handler.mjs';
import { digest } from '../../service/intake.mjs';
import { report } from '../../tests/fixtures.mjs';

const origin = 'https://reports.example.test', publicOrigin = 'https://zestyts.github.io';
function setup(t, profile = { id: 1396621, login: 'ZestyTS' }, tokenReply = { access_token: 'authored-token', token_type: 'bearer', scope: '' }) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  sqlite.exec(readFileSync(new URL('../../service/drizzle/0000_hard_havok.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../auth-schema.sql', import.meta.url), 'utf8'));
  function prepare(sql) {
    const statement = sqlite.prepare(sql); let args = [];
    const api = { bind(...values) { args = values; return api; }, async first() { return statement.get(...args) || null; },
      async all() { return { results: statement.all(...args) }; }, async run() { return statement.run(...args); } }; return api;
  }
  const DB = { prepare, async batch(statements) {
    sqlite.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.all()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  const env = { DB, SERVICE_ORIGIN: origin, INTAKE_SECRET: 'authored-secret-not-production-'.repeat(2), GITHUB_OWNER_ID: '1396621',
    GITHUB_CLIENT_ID: 'authored-client-id', github_client_secret: 'authored-client-secret', ASSETS: { fetch: async () => new Response('authored shell') } };
  let stamp = Date.now(); const calls = [];
  const worker = createWorker({ now: () => stamp, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return url.endsWith('/access_token') ? tokenReply instanceof Response ? tokenReply : Response.json(tokenReply)
      : profile instanceof Response ? profile : Response.json(profile);
  } });
  const request = (path, options = {}) => worker.fetch(new Request(origin + path, options), env);
  return { sqlite, env, worker, request, calls, advance: milliseconds => { stamp += milliseconds; } };
}
async function begin(fixture) {
  const response = await fixture.request('/auth/login'); assert.equal(response.status, 303);
  const authorize = new URL(response.headers.get('location')), state = authorize.searchParams.get('state');
  assert.equal(authorize.origin, 'https://github.com'); assert.equal(authorize.searchParams.get('scope'), '');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256'); assert.match(authorize.searchParams.get('code_challenge'), /^[a-zA-Z0-9_-]{43}$/);
  assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  return { state, authorize, cookie: '__Host-uif-oauth=' + state };
}
async function login(fixture) {
  const start = await begin(fixture);
  const response = await fixture.request('/auth/callback?state=' + start.state + '&code=authored-code', { headers: { Cookie: start.cookie } });
  assert.equal(response.status, 303);
  const header = response.headers.getSetCookie().find(value => value.startsWith('__Host-uif-reviewer='));
  assert.ok(header); const cookie = header.split(';')[0];
  const session = await (await fixture.request('/api/session', { headers: { Cookie: cookie } })).json();
  return { ...start, cookie, csrf: session.csrf };
}

test('GitHub identity is checked server-side and session cookies contain only random tokens', async t => {
  const f = setup(t), logged = await login(f);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[0].url, 'https://github.com/login/oauth/access_token');
  const exchanged = new URLSearchParams(f.calls[0].options.body);
  assert.equal(exchanged.get('client_secret'), f.env.github_client_secret); assert.equal(exchanged.get('redirect_uri'), origin + '/auth/callback');
  assert.match(exchanged.get('code_verifier'), /^[a-f0-9]{64}$/);
  const pkce = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(exchanged.get('code_verifier'))));
  assert.equal(btoa(String.fromCharCode(...pkce)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''), logged.authorize.searchParams.get('code_challenge'));
  assert.equal(f.calls[1].url, 'https://api.github.com/user'); assert.equal(f.calls[1].options.headers.Authorization, 'Bearer authored-token');
  assert.ok(f.calls.every(call => call.options.redirect === 'manual'));
  const saved = f.sqlite.prepare('SELECT * FROM reviewer_sessions').get();
  assert.notEqual(saved.token_hash, logged.cookie.split('=')[1]); assert.ok(!JSON.stringify(saved).includes('authored-token'));
  assert.equal((await f.request('/api/moderation', { headers: { Cookie: logged.cookie } })).status, 200);
});
test('foreign accounts cannot create a reviewer session', async t => {
  const f = setup(t, { id: 999, login: 'NotTheOwner' }), start = await begin(f);
  const response = await f.request('/auth/callback?state=' + start.state + '&code=fixture', { headers: { Cookie: start.cookie } });
  assert.equal(response.status, 403); assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM reviewer_sessions').get().n, 0);
});
test('spoofed legacy identity, user IDs and fake session cookies never authorize moderation', async t => {
  const f = setup(t); f.env.MODERATOR_EMAIL = 'reviewer@example.test';
  for (const headers of [{ 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'reviewer@example.test' },
    { 'x-github-user-id': '1396621' }, { Cookie: '__Host-uif-reviewer=' + 'a'.repeat(64) }])
    assert.equal((await f.request('/api/moderation', { headers })).status, 403);
});
test('OAuth state must match the browser and is expiring and single-use', async t => {
  const f = setup(t), start = await begin(f);
  assert.equal((await f.request('/auth/callback?state=' + start.state + '&code=fixture')).status, 403); assert.equal(f.calls.length, 0);
  f.advance(600001);
  assert.equal((await f.request('/auth/callback?state=' + start.state + '&code=fixture', { headers: { Cookie: start.cookie } })).status, 403); assert.equal(f.calls.length, 0);
  const logged = await login(f), count = f.calls.length;
  assert.equal((await f.request('/auth/callback?state=' + logged.state + '&code=fixture', { headers: { Cookie: '__Host-uif-oauth=' + logged.state } })).status, 403);
  assert.equal(f.calls.length, count);
});
test('moderation requires both the same Origin and a session-bound CSRF proof', async t => {
  const f = setup(t), logged = await login(f), data = JSON.stringify({ receipt: 'a'.repeat(32), action: 'approve' });
  for (const extra of [{}, { Origin: publicOrigin, 'X-UIF-CSRF': logged.csrf }, { Origin: origin, 'X-UIF-CSRF': 'wrong' }])
    assert.equal((await f.request('/api/moderation', { method: 'POST', headers: { Cookie: logged.cookie, 'Content-Type': 'application/json', ...extra }, body: data })).status, 403);
});
test('anonymous intake remains private until an actual authenticated review; rejection erases body', async t => {
  const f = setup(t), headers = { Origin: publicOrigin, 'Content-Type': 'application/json' };
  const { challenge } = await (await f.request('/api/challenge', { headers })).json();
  let proof = 0; while (!(await digest(challenge + '.' + proof)).startsWith('000')) proof++;
  const sent = await f.request('/api/submissions', { method: 'POST', headers, body: JSON.stringify({ report: report(), consent: true, website: '', challenge, proof }) });
  assert.equal(sent.status, 202); const { receipt } = await sent.json();
  assert.equal((await (await f.request('/api/reports')).json()).reports.length, 0);
  assert.deepEqual(await (await f.request('/api/receipts/' + receipt)).json(), { status: 'pending' });
  const logged = await login(f), reviewerHeaders = { Origin: origin, Cookie: logged.cookie, 'X-UIF-CSRF': logged.csrf, 'Content-Type': 'application/json' };
  assert.equal((await f.request('/api/moderation', { method: 'POST', headers: reviewerHeaders, body: JSON.stringify({ receipt, action: 'approve' }) })).status, 200);
  assert.equal((await (await f.request('/api/reports')).json()).reports.length, 1);
  assert.equal((await f.request('/api/moderation', { method: 'POST', headers: reviewerHeaders, body: JSON.stringify({ receipt, action: 'reject' }) })).status, 200);
  assert.equal((await (await f.request('/api/reports')).json()).reports.length, 0);
  assert.equal(f.sqlite.prepare('SELECT body FROM submissions WHERE receipt=?').get(receipt).body, '{}');
});
test('logout revokes the session, expiry and owner changes fail closed', async t => {
  const f = setup(t), logged = await login(f);
  assert.equal((await f.request('/auth/logout', { method: 'POST', headers: { Cookie: logged.cookie, Origin: origin } })).status, 403);
  assert.equal((await f.request('/auth/logout', { method: 'POST', headers: { Cookie: logged.cookie, Origin: origin, 'X-UIF-CSRF': logged.csrf } })).status, 204);
  assert.equal((await f.request('/api/session', { headers: { Cookie: logged.cookie } })).status, 401);
  const second = await login(f); f.env.GITHUB_OWNER_ID = '999';
  assert.equal((await f.request('/api/moderation', { headers: { Cookie: second.cookie } })).status, 403);
  f.env.GITHUB_OWNER_ID = '1396621'; f.advance(7200001);
  assert.equal((await f.request('/api/session', { headers: { Cookie: second.cookie } })).status, 401);
});
test('missing runtime configuration, wrong service host and unconfigured login stay closed', async t => {
  const f = setup(t);
  assert.equal((await f.worker.fetch(new Request('https://evil.test/api/moderation'), f.env)).status, 503);
  assert.equal((await f.worker.fetch(new Request(origin + '/api/reports'), { ...f.env, INTAKE_SECRET: '' })).status, 503);
  f.env.github_client_secret = '';
  assert.equal((await f.request('/auth/login')).status, 503);
  assert.equal((await f.request('/health')).status, 200);
  assert.equal((await f.request('/api/moderation')).status, 403);
});

test('GitHub sign-in uses the exact lowercase secret binding name', async t => {
  const f = setup(t);
  assert.equal((await (await f.request('/health')).json()).loginConfigured, true);
  delete f.env.github_client_secret;
  f.env.GITHUB_CLIENT_SECRET = 'authored-obsolete-binding';
  assert.equal((await (await f.request('/health')).json()).loginConfigured, false);
  assert.equal((await f.request('/auth/login')).status, 503);
  assert.equal(f.calls.length, 0);
});
test('unexpected GitHub grants and upstream failures cannot create sessions or leak secrets', async t => {
  for (const token of [{ access_token: 'authored-token', token_type: 'bearer', scope: 'repo' }, new Response('authored-client-secret', { status: 500 })]) {
    const f = setup(t, undefined, token), start = await begin(f);
    const result = await f.request('/auth/callback?state=' + start.state + '&code=fixture', { headers: { Cookie: start.cookie } });
    assert.ok([403, 502].includes(result.status)); assert.ok(!(await result.text()).includes('authored-client-secret'));
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM reviewer_sessions').get().n, 0);
  }
});
test('login rate identifiers are hashed and excessive network attempts are rejected', async t => {
  const f = setup(t), headers = { 'cf-connecting-ip': '192.0.2.20' };
  for (let i = 0; i < 12; i++) assert.equal((await f.request('/auth/login', { headers })).status, 303);
  assert.equal((await f.request('/auth/login', { headers })).status, 429);
  const rows = f.sqlite.prepare('SELECT bucket FROM rate_limits').all(); assert.ok(!JSON.stringify(rows).includes('192.0.2.20'));
});
test('duplicate cookies and duplicate callback parameters fail closed', async t => {
  const f = setup(t), start = await begin(f);
  assert.equal((await f.request('/auth/callback?state=' + start.state + '&state=' + start.state + '&code=fixture', { headers: { Cookie: start.cookie } })).status, 403);
  const logged = await login(f);
  assert.equal((await f.request('/api/session', { headers: { Cookie: logged.cookie + '; ' + logged.cookie } })).status, 401);
});
test('review routing preserves the clean URL for the Cloudflare asset binding', async t => {
  const f = setup(t); f.env.ASSETS.fetch = async request => {
    assert.equal(new URL(request.url).pathname, '/review'); return new Response('authored review shell', { headers: { 'Content-Type': 'text/html' } });
  };
  const response = await f.request('/review'); assert.equal(response.status, 200); assert.equal(response.headers.get('location'), null);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('unexpected OAuth failures expose only a fixed step and category, never upstream details', async t => {
  for (const invalidJson of [false, true]) {
    const f = setup(t), start = await begin(f);
    const worker = createWorker({ fetchImpl: async () => {
      if (invalidJson) return new Response('authored-private-response-not-json');
      throw new TypeError('authored-private-token-and-callback-details');
    } });
    const response = await worker.fetch(new Request(origin + '/auth/callback?state=' + start.state + '&code=authored-private-code',
      { headers: { Cookie: start.cookie } }), f.env);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'The report service is unavailable. Please try again later.',
      reference: invalidJson ? 'github-token-json' : 'github-token-request', category: invalidJson ? 'invalid-json' : 'runtime-type' });
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM reviewer_sessions').get().n, 0);
  }
});

test('GitHub redirects are never followed at either credential-bearing request', async t => {
  for (const status of [301, 302, 303, 307, 308]) {
    for (const step of ['token', 'profile']) {
      const upstream = new Response('authored-private-redirect-body', { status, headers: { Location: 'https://foreign.example.test/collect' } });
      const f = step === 'token' ? setup(t, undefined, upstream) : setup(t, upstream), start = await begin(f);
      const response = await f.request('/auth/callback?state=' + start.state + '&code=authored-code', { headers: { Cookie: start.cookie } });
      assert.equal(response.status, 502);
      assert.equal(f.calls.length, step === 'token' ? 1 : 2);
      assert.ok(f.calls.every(call => call.options.redirect === 'manual'));
      assert.ok(f.calls.every(call => ['github.com', 'api.github.com'].includes(new URL(call.url).hostname)));
      assert.ok(!(await response.text()).includes('authored-private-redirect-body'));
      assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM reviewer_sessions').get().n, 0);
    }
  }
});
