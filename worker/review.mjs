import { labels } from './registry.mjs';
const $ = id => document.getElementById(id);
const element = (tag, value) => { const node = document.createElement(tag); node.textContent = value; return node; };
let csrf = '', busy = false, next = '', generation = 0, loaded = 0;
function setBusy(value) { busy = value; $('review-controls').disabled = value; $('sign-out').disabled = value; }
function signedOut(message) {
  csrf = ''; $('queue').replaceChildren(); $('review-controls').hidden = true; $('sign-out').hidden = true;
  $('sign-in').hidden = false; $('reviewer').textContent = ''; $('message').textContent = message;
}
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (response.status === 204) return null;
  const reader = response.body.getReader(), chunks = []; let count = 0;
  while (true) {
    const part = await reader.read(); if (part.done) break;
    count += part.value.byteLength; if (count > 4000000) { await reader.cancel(); throw new Error('The review response is too large.'); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(count); let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (!response.ok) {
    if ([401, 403].includes(response.status)) signedOut('Reviewer session expired or access was denied. Sign in again.');
    throw new Error(typeof data.error === 'string' ? data.error : 'The request failed.');
  }
  return data;
}
function row(item) {
  const article = document.createElement('article'), report = item.body; article.className = 'review-report';
  const status = { pending: 'Awaiting review', approved: 'Published', rejected: 'Rejected / removed' }[item.status] || item.status;
  article.append(element('h2', report?.gameName || 'Removed submission'), element('p', status + ' / ' + new Date(item.created_at).toLocaleString()));
  const receipt = element('p', 'Receipt: ' + item.receipt); receipt.className = 'small receipt'; article.append(receipt);
  if (!report) return article;
  const facts = document.createElement('dl');
  for (const [key, value] of Object.entries({ System: labels[report.console] || report.console, Outcome: { Works: 'Working', Issues: 'With issues', Broken: 'Not working' }[report.outcome], 'UIF version': report.uifVersion,
    Environment: report.environment, Base: report.baseName, Runtime: report.evidence?.runtime })) facts.append(element('dt', key), element('dd', String(value || 'Unknown')));
  article.append(facts, element('h3', 'Notes'));
  const notes = element('p', report.notes || 'No notes.'); notes.className = 'preserve-lines'; article.append(notes);
  const details = document.createElement('details'); details.append(element('summary', 'Full report and evidence'), element('pre', JSON.stringify(report, null, 2))); article.append(details);
  const actions = document.createElement('div'); actions.className = 'actions';
  for (const action of item.status === 'pending' ? ['approve', 'reject'] : ['reject']) {
    const button = element('button', action === 'approve' ? 'Approve and publish' : item.status === 'approved' ? 'Remove and erase contents' : 'Reject and erase contents');
    button.className = action === 'approve' ? 'primary' : 'quiet danger'; button.type = 'button';
    button.addEventListener('click', () => decide(item.receipt, action)); actions.append(button);
  }
  article.append(actions); return article;
}
async function load(after = '') {
  const current = ++generation; setBusy(true); $('message').textContent = 'Loading private queue...';
  try {
    const data = await api('/api/moderation?' + new URLSearchParams({ status: $('status').value, ...(after ? { after } : {}) }));
    if (current !== generation) return;
    if (!after) { $('queue').replaceChildren(); loaded = 0; }
    $('queue').append(...data.submissions.map(row)); loaded += data.submissions.length; next = data.nextCursor;
    $('count').textContent = loaded + (loaded === 1 ? ' report' : ' reports') + (next ? ' loaded' : '');
    $('more').hidden = !next; $('message').textContent = loaded ? '' : 'No submissions in this queue.';
  } catch (error) { if (current === generation) $('message').textContent = error.message; }
  finally { if (current === generation) setBusy(false); }
}
async function decide(receipt, action) {
  if (busy || !confirm(action === 'approve' ? 'Publish this report to the public compatibility list?' : 'Reject or remove this report and erase its submitted contents?')) return;
  setBusy(true); $('message').textContent = 'Saving review...';
  try {
    await api('/api/moderation', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-UIF-CSRF': csrf }, body: JSON.stringify({ receipt, action }) });
    await load();
  } catch (error) { $('message').textContent = error.message; }
  finally { setBusy(false); }
}
$('status').addEventListener('change', () => load()); $('refresh').addEventListener('click', () => load()); $('more').addEventListener('click', () => load(next));
$('sign-out').addEventListener('click', async () => {
  setBusy(true);
  try { await api('/auth/logout', { method: 'POST', headers: { 'X-UIF-CSRF': csrf } }); signedOut('Signed out.'); }
  catch (error) { $('message').textContent = error.message; }
  finally { setBusy(false); }
});
async function start() {
  try {
    const session = await api('/api/session'); csrf = session.csrf; $('reviewer').textContent = session.reviewer;
    $('sign-in').hidden = true; $('sign-out').hidden = false; $('review-controls').hidden = false; await load();
  } catch (error) { signedOut(error.message); }
}
start();
