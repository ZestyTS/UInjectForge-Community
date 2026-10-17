import { handle, digest } from '../service/intake.mjs';

const sessionCookie = '__Host-uif-reviewer', stateCookie = '__Host-uif-oauth';
const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const cookie = (name, value, maxAge) => name + '=' + value + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + maxAge;
const secureHeaders = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" };
const failure = (status, message) => { throw Object.assign(new Error(message), { status }); };
function readCookie(request, name) {
  const values = (request.headers.get('Cookie') || '').split(';').map(part => part.trim()).filter(part => part.startsWith(name + '='));
  if (values.length !== 1) return '';
  const value = values[0].slice(name.length + 1); return /^[a-f0-9]{64}$/.test(value) ? value : '';
}
function same(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let difference = 0; for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i); return difference === 0;
}
async function csrf(secret, token) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode('reviewer-csrf:' + token)));
}
function redirect(url, cookies = []) {
  const headers = new Headers({ ...secureHeaders, Location: url });
  for (const value of cookies) headers.append('Set-Cookie', value);
  return new Response(null, { status: 303, headers });
}
async function remoteJson(fetchImpl, url, options, step, limit = 16384) {
  step('request');
  // Workers supports manual/follow only; reject non-2xx responses without following redirects.
  const response = await fetchImpl(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  step('response');
  if (!response.ok) { await response.body?.cancel(); failure(502, 'GitHub sign-in is unavailable. Please try again.'); }
  step('body');
  const reader = response.body.getReader(), parts = []; let size = 0;
  while (true) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength; if (size > limit) { await reader.cancel(); failure(502, 'GitHub response exceeded its size limit.'); }
    parts.push(part.value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  step('json');
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function createWorker({ fetchImpl = fetch, now = Date.now } = {}) {
  return { async fetch(request, env) {
    const reply = (value, status = 200) => Response.json(value, { status, headers: secureHeaders });
    let operation = '';
    try {
      const url = new URL(request.url), origin = env.SERVICE_ORIGIN;
      if (!origin || new URL(origin).origin !== origin || !origin.startsWith('https://') || url.origin !== origin
        || !env.DB || !env.INTAKE_SECRET || env.INTAKE_SECRET.length < 32 || !/^\d+$/.test(env.GITHUB_OWNER_ID || ''))
        return reply({ error: 'The report service is not configured yet.' }, 503);
      const db = env.DB, stamp = now();
      async function session() {
        const token = readCookie(request, sessionCookie); if (!token) return null;
        const row = await db.prepare('SELECT github_id,github_login,expires_at FROM reviewer_sessions WHERE token_hash=?').bind(await digest(token)).first();
        return row && row.github_id === env.GITHUB_OWNER_ID && row.expires_at > stamp ? { ...row, token } : null;
      }
      async function authorizeWrite(current) {
        if (!current || request.headers.get('origin') !== origin
          || !same(request.headers.get('x-uif-csrf'), await csrf(env.INTAKE_SECRET, current.token)))
          failure(403, 'Reviewer session or verification is missing. Refresh the review page and retry.');
      }
      if (url.pathname === '/health' && request.method === 'GET')
        return reply({ ok: true, authentication: 'github', loginConfigured: Boolean(env.GITHUB_CLIENT_ID && env.github_client_secret) });
      if (url.pathname === '/auth/login' && request.method === 'GET') {
        if (!env.GITHUB_CLIENT_ID || !env.github_client_secret) failure(503, 'GitHub reviewer sign-in is not configured yet.');
        await db.batch([db.prepare('DELETE FROM oauth_states WHERE expires_at<=?').bind(stamp), db.prepare('DELETE FROM reviewer_sessions WHERE expires_at<=?').bind(stamp),
          db.prepare('DELETE FROM rate_limits WHERE expires_at<=?').bind(stamp)]);
        const hour = Math.floor(stamp / 3600000), network = request.headers.get('cf-connecting-ip');
        const buckets = [['oauth:hour:' + hour, 50]];
        if (network) buckets.push(['oauth:network:' + hour + ':' + await csrf(env.INTAKE_SECRET, 'login:' + network), 12]);
        const rates = await db.batch(buckets.map(([bucket]) => db.prepare('INSERT INTO rate_limits VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(bucket, stamp + 3600000)));
        if (rates.some((rate, i) => rate.results[0].attempts > buckets[i][1])) failure(429, 'Sign-in limit reached. Please try later.');
        const previousState = readCookie(request, stateCookie);
        if (previousState) await db.prepare('DELETE FROM oauth_states WHERE state_hash=?').bind(await digest(previousState)).run();
        const count = await db.prepare('SELECT count(*) AS count FROM oauth_states').first();
        if (count.count >= 100) failure(429, 'Sign-in is busy. Please try again in a few minutes.');
        const state = random(), verifier = random();
        await db.prepare('INSERT INTO oauth_states VALUES(?,?,?)').bind(await digest(state), verifier, stamp + 600000).run();
        const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier)));
        const challenge = btoa(String.fromCharCode(...hash)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
        const authorize = new URL('https://github.com/login/oauth/authorize');
        authorize.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: origin + '/auth/callback',
          state, scope: '', code_challenge: challenge, code_challenge_method: 'S256', allow_signup: 'false', prompt: 'select_account' }).toString();
        return redirect(authorize.href, [cookie(stateCookie, state, 600)]);
      }
      if (url.pathname === '/auth/callback' && request.method === 'GET') {
        operation = 'oauth-state';
        const state = url.searchParams.get('state'), code = url.searchParams.get('code');
        if (!env.GITHUB_CLIENT_ID || !env.github_client_secret || !same(state, readCookie(request, stateCookie))
          || url.searchParams.getAll('state').length !== 1 || url.searchParams.getAll('code').length !== 1
          || !/^[a-f0-9]{64}$/.test(state || '') || !code || code.length > 1024) failure(403, 'Sign-in verification failed. Start sign-in again.');
        // Consume the browser-bound state atomically before exchanging the one-use GitHub code.
        const saved = await db.prepare('DELETE FROM oauth_states WHERE state_hash=? AND expires_at>? RETURNING verifier').bind(await digest(state), stamp).first();
        if (!saved) failure(403, 'Sign-in expired or was already used. Start sign-in again.');
        operation = 'github-token';
        const tokens = await remoteJson(fetchImpl, 'https://github.com/login/oauth/access_token', { method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.github_client_secret,
            code, redirect_uri: origin + '/auth/callback', code_verifier: saved.verifier }).toString() }, step => { operation = 'github-token-' + step; });
        if (typeof tokens.access_token !== 'string' || tokens.access_token.length > 1024 || tokens.token_type?.toLowerCase() !== 'bearer'
          || (typeof tokens.scope === 'string' && tokens.scope.trim() !== '')) failure(403, 'Unexpected GitHub sign-in permissions. Check the dedicated sign-in application.');
        operation = 'github-profile';
        const user = await remoteJson(fetchImpl, 'https://api.github.com/user', { headers: { Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + tokens.access_token, 'User-Agent': 'UInjectForge-Community-Reviewer' } }, step => { operation = 'github-profile-' + step; });
        if (!Number.isSafeInteger(user.id) || String(user.id) !== env.GITHUB_OWNER_ID || typeof user.login !== 'string')
          failure(403, 'This GitHub account is not the authorized reviewer. Sign in with the project owner account.');
        operation = 'reviewer-session';
        const previous = readCookie(request, sessionCookie), token = random();
        if (previous) await db.prepare('DELETE FROM reviewer_sessions WHERE token_hash=?').bind(await digest(previous)).run();
        await db.prepare('INSERT INTO reviewer_sessions VALUES(?,?,?,?)').bind(await digest(token), String(user.id), user.login, stamp + 7200000).run();
        return redirect(origin + '/review', [cookie(stateCookie, '', 0), cookie(sessionCookie, token, 7200)]);
      }
      if (url.pathname === '/api/session' && request.method === 'GET') {
        const current = await session(); if (!current) return reply({ error: 'Sign in with GitHub to review reports.' }, 401);
        return reply({ reviewer: current.github_login, csrf: await csrf(env.INTAKE_SECRET, current.token) });
      }
      if (url.pathname === '/auth/logout' && request.method === 'POST') {
        const current = await session(); await authorizeWrite(current);
        await db.prepare('DELETE FROM reviewer_sessions WHERE token_hash=?').bind(await digest(current.token)).run();
        return new Response(null, { status: 204, headers: { ...secureHeaders, 'Set-Cookie': cookie(sessionCookie, '', 0) } });
      }
      if (url.pathname.startsWith('/api/')) {
        const current = url.pathname === '/api/moderation' ? await session() : null;
        if (url.pathname === '/api/moderation' && request.method === 'POST') await authorizeWrite(current);
        return handle(request, env, { origin, moderator: Boolean(current) });
      }
      if (/^\/receipt\/[a-f0-9]{32}$/.test(url.pathname))
        return redirect('https://zestyts.github.io/UInjectForge-Community/#status?receipt=' + url.pathname.split('/').at(-1));
      if (url.pathname === '/') return redirect('https://zestyts.github.io/UInjectForge-Community/');
      const response = await env.ASSETS.fetch(request), headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(secureHeaders)) headers.set(key, value);
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      if (!error.status && operation)
        return reply({ error: 'The report service is unavailable. Please try again later.', reference: operation,
          category: error instanceof SyntaxError ? 'invalid-json' : error instanceof TypeError
            ? error.message.includes('Illegal invocation') ? 'invalid-context' : 'runtime-type' : 'operation' }, 503);
      return reply({ error: error.status ? error.message : 'The report service is unavailable. Please try again later.' }, error.status || 503);
    }
  } };
}

export default createWorker();
