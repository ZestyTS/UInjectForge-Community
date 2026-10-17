import { systems, labels, validateReport, validateRegistry, filterReports } from './registry.mjs';
import { intakeOrigin, intakeEnabled } from './config.mjs';
import { filterKeys, readRoute, reportsHash, orderReports, reportPage, parseReceipt, statusLink } from './navigation.mjs';

const $ = id => document.getElementById(id);
const publicSite = 'https://zestyts.github.io/UInjectForge-Community/';
$('skip-content').addEventListener('click', event => {
  event.preventDefault(); $('main').focus(); $('main').scrollIntoView({ block: 'start' });
});
const names = { Works: 'Working', Issues: 'With issues', Broken: 'Not working' };
const checkNames = ['boot', 'controls', 'audio', 'video', 'save', 'manual'];
const identityFields = ['game-name', 'report-system', 'uif-version', 'base-name', 'report-runtime', 'game-id', 'report-output'];
const systemButtons = new Map();
let entries = [], matching = [], imported = null, entryMode = 'import', draftDirty = false;
let dataState = 'loading', loading = false, currentPage = 1, selectedReportId = '';
let sending = false, submissionController = null, importGeneration = 0;
let lastReceipt = null, currentReceipt = '', statusGeneration = 0, statusController = null;
let browseHash = '#reports', draft = newDraft();

function newDraft() {
  const now = new Date().toISOString();
  return { schemaVersion: 1, reportId: crypto.randomUUID().replaceAll('-', ''), reportedAtUtc: now, builtAtUtc: now,
    gameId: '', baseTitleId: '', customBase: false, buildSucceeded: null,
    evidence: { runtime: '', settings: {}, fingerprints: {}, omittedOptions: 0,
      scope: 'Manually entered test report. Build time is the entry time; settings and runtime fingerprints were not captured by UIF.' } };
}
function text(tag, value) { const e = document.createElement(tag); e.textContent = value; return e; }
function option(value, label = value) { const e = text('option', label); e.value = value; return e; }
function setSelect(id, value) {
  const select = $(id);
  if (value && ![...select.options].some(item => item.value === value)) select.append(option(value));
  select.value = value;
}
for (const s of systems) {
  $('system').append(option(s, labels[s]));
  $('report-system').append(option(s, labels[s]));
}
for (const name of checkNames) {
  const label = text('label', name[0].toUpperCase() + name.slice(1)), select = document.createElement('select');
  select.id = 'check-' + name;
  for (const value of ['Not tested', 'Pass', 'Issues', 'Fail']) select.append(option(value));
  label.append(select); $('check-fields').append(label);
}
for (const s of ['', ...systems]) {
  const button = text('button', s ? labels[s] : 'All systems'), count = text('small', '-');
  button.type = 'button'; button.append(count);
  button.addEventListener('click', () => {
    $('system').value = s; currentPage = 1;
    location.hash = reportsHash(filters(), $('sort').value);
    render(true);
  });
  systemButtons.set(s, { button, count }); $('system-nav').append(button);
}
function filters() { return Object.fromEntries(filterKeys.map(key => [key, $(key).value])); }
function syncBrowseUrl() {
  browseHash = reportsHash(filters(), $('sort').value, currentPage);
  $('nav-reports').href = browseHash;
  document.querySelector('.brand').href = browseHash;
  const route = readRoute(location.hash);
  if (route.view === 'reports' && !route.reportId) history.replaceState(null, '', browseHash);
}
function applyRoute() {
  const state = readRoute(location.hash);
  for (const view of ['reports', 'submit', 'status']) {
    $(view).hidden = state.view !== view;
    $('nav-' + view).setAttribute('aria-current', state.view === view ? 'page' : 'false');
  }
  if (state.view === 'reports') {
    if (!state.reportId) {
      for (const key of filterKeys) key === 'search' ? $(key).value = state.filters[key] : setSelect(key, state.filters[key]);
      $('sort').value = state.sort; currentPage = state.page;
    }
    render(!state.reportId);
    if (state.reportId && dataState !== 'loading') {
      const entry = entries.find(e => e.report.reportId.toLowerCase() === state.reportId);
      if (entry) showDetail(entry);
      else $('browse-status').textContent = dataState === 'unavailable' || dataState === 'partial'
        ? 'This report could not be found among the loaded results. Retry when all report sources are available.'
        : 'This public report was not found. It may have been removed or may not be published.';
    }
  }
  if (!state.reportId && $('detail').open) $('detail').close();
  if (state.view === 'status' && state.receipt && state.receipt !== currentReceipt) {
    $('receipt-input').value = state.receipt; lookupReceipt(state.receipt);
  }
}
window.addEventListener('hashchange', applyRoute);
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  $('theme').title = label; $('theme').setAttribute('aria-label', label);
  $('theme').querySelector('img').src = 'assets/' + (theme === 'dark' ? 'sun' : 'moon') + '.svg';
}
try { setTheme(localStorage.getItem('uif-theme') === 'light' ? 'light' : 'dark'); } catch { setTheme('dark'); }
$('theme').addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  setTheme(theme); try { localStorage.setItem('uif-theme', theme); } catch {}
});
function fact(list, key, value) { list.append(text('dt', key), text('dd', String(value))); }
function showDetail(entry) {
  const r = entry.report; selectedReportId = r.reportId;
  $('detail-title').textContent = r.gameName; $('detail-scope').textContent = r.evidence.scope;
  const list = document.createElement('dl');
  for (const [key, value] of Object.entries({ System: labels[r.console], Result: names[r.outcome],
    'UIF version': r.uifVersion, Environment: r.environment, Base: r.baseName, Runtime: r.evidence.runtime,
    Region: r.gameRegion || 'Unknown', Revision: r.gameRevision || 'Unknown', 'Game identifier': r.gameId || 'Unknown',
    'Base title ID': r.baseTitleId || 'Unknown', 'Custom base': r.customBase ? 'Yes' : 'No', Output: r.outputMode,
    'Build succeeded': r.buildSucceeded === null ? 'Unknown' : r.buildSucceeded ? 'Yes' : 'No',
    'Built at': r.builtAtUtc, 'Reported at': r.reportedAtUtc })) fact(list, key, value);
  $('detail-facts').replaceChildren(list); $('detail-checks').replaceChildren();
  for (const key of checkNames) fact($('detail-checks'), key, r.checks[key] || 'Not tested');
  $('detail-json').textContent = JSON.stringify(r.evidence, null, 2);
  $('detail-notes').textContent = r.notes || 'No notes.';
  $('detail-review').textContent = 'Reviewed by ' + entry.review.reviewer + ' on ' + new Date(entry.review.reviewedAtUtc).toLocaleDateString() + '.';
  $('detail-source').hidden = !entry.review.issueUrl;
  if (entry.review.issueUrl) $('detail-source').href = entry.review.issueUrl;
  $('detail-status').textContent = '';
  if (!$('detail').open) $('detail').showModal();
}
$('close-detail').addEventListener('click', () => $('detail').close());
$('detail').addEventListener('close', () => {
  if (readRoute(location.hash).reportId) { history.replaceState(null, '', browseHash); applyRoute(); }
});
async function copyLink(value, feedback) {
  try { await navigator.clipboard.writeText(value); $(feedback).textContent = 'Link copied.'; }
  catch { $(feedback).textContent = 'Clipboard unavailable. Link: ' + value; }
}
$('copy-report-link').addEventListener('click', () => {
  if (selectedReportId) copyLink(publicSite + '#report/' + selectedReportId, 'detail-status');
});
function render(sync = false) {
  const active = filters(), usable = dataState === 'ready' || dataState === 'partial';
  matching = orderReports(filterReports(entries, active), $('sort').value);
  const page = reportPage(matching, currentPage);
  if (usable) currentPage = page.current;
  $('count').textContent = dataState === 'loading' ? 'Loading reports...' : dataState === 'unavailable' ? 'Reports unavailable'
    : matching.length + (dataState === 'partial' ? ' loaded report' : ' report') + (matching.length === 1 ? '' : 's')
      + (matching.length !== entries.length ? ' of ' + entries.length : '');
  $('report-table').setAttribute('aria-busy', String(loading));
  $('rows').replaceChildren(...page.entries.map(entry => {
    const r = entry.report, row = document.createElement('tr'), game = text('td', r.gameName);
    game.append(text('small', labels[r.console] + (r.gameRegion ? ' / ' + r.gameRegion : '')));
    const outcome = document.createElement('td'), badge = text('span', names[r.outcome]);
    badge.className = 'badge ' + r.outcome.toLowerCase(); outcome.append(badge);
    const base = text('td', r.baseName); base.append(text('small', r.evidence.runtime));
    const build = text('td', r.uifVersion); build.append(text('small', r.environment));
    const action = document.createElement('td'), button = text('button', 'Details'); button.type = 'button';
    button.setAttribute('aria-label', 'View ' + r.gameName + ' report');
    button.addEventListener('click', () => { location.hash = 'report/' + r.reportId; }); action.append(button);
    row.append(game, outcome, base, build, action); return row;
  }));
  $('stats').hidden = !usable || entries.length === 0;
  $('total').textContent = usable ? String(entries.length) : '-';
  $('total-label').textContent = dataState === 'partial' ? 'Loaded reviewed reports' : 'Reviewed reports';
  for (const [value, id] of [['Works', 'works-total'], ['Issues', 'issues-total'], ['Broken', 'broken-total']])
    $(id).textContent = usable ? entries.filter(e => e.report.outcome === value).length : '-';
  for (const [system, item] of systemButtons) {
    item.button.setAttribute('aria-pressed', String(active.system === system));
    item.count.textContent = usable ? entries.filter(e => !system || e.report.console === system).length : '-';
  }
  $('download').disabled = !usable || matching.length === 0;
  $('empty').hidden = !usable || matching.length !== 0;
  $('empty').querySelector('h2').textContent = dataState === 'partial' ? 'No reports loaded' : entries.length ? 'No matching reports' : 'No reports yet';
  $('empty').querySelector('p').textContent = dataState === 'partial' ? 'Some report sources are unavailable. Retry to check the remaining results.'
    : entries.length ? 'Try another system or clear your filters.' : 'Public UIF results appear here after review. You can share a tested build without an account.';
  $('empty-action').textContent = dataState === 'partial' ? 'Retry loading' : entries.length ? 'Clear filters' : 'Share a result';
  $('empty-action').href = entries.length || dataState === 'partial' ? '#reports' : '#submit';
  $('pagination').hidden = !usable || page.pages <= 1;
  $('page-summary').textContent = page.start + '-' + page.end + ' of ' + matching.length;
  $('page-number').textContent = 'Page ' + page.current + ' of ' + page.pages;
  $('previous-page').disabled = page.current === 1; $('next-page').disabled = page.current === page.pages;
  if (sync) syncBrowseUrl();
}
function clearFilters() {
  for (const key of filterKeys) $(key).value = '';
  $('sort').value = 'recent'; currentPage = 1; $('browse-status').textContent = ''; render(true);
}
$('filters').addEventListener('submit', e => e.preventDefault());
$('filters').addEventListener('input', () => { currentPage = 1; $('browse-status').textContent = ''; render(true); });
$('filters').addEventListener('reset', e => { e.preventDefault(); clearFilters(); });
$('sort').addEventListener('change', () => { currentPage = 1; render(true); });
$('empty-action').addEventListener('click', e => {
  if (dataState === 'partial') { e.preventDefault(); load(); }
  else if (entries.length) { e.preventDefault(); clearFilters(); }
});
for (const [id, delta] of [['previous-page', -1], ['next-page', 1]]) $(id).addEventListener('click', () => {
  currentPage += delta; render(true); $('report-table').scrollIntoView({ block: 'start' });
});
$('share-view').addEventListener('click', () => copyLink(publicSite + reportsHash(filters(), $('sort').value, currentPage), 'browse-status'));
function download(value, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('download').addEventListener('click', () => { if (matching.length) download({ schemaVersion: 1, reports: matching }, 'uif-compatibility-results.json'); });
async function jsonFetch(url, options = {}) {
  const { limit = 16000000, signal, ...request } = options;
  const deadline = AbortSignal.timeout(20000);
  const response = await fetch(url, { ...request, signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    redirect: 'error', credentials: 'omit', cache: 'no-store' });
  if (Number(response.headers.get('content-length')) > limit) throw new Error('Response exceeds its size limit.');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > limit) { await reader.cancel(); throw new Error('Response exceeds its size limit.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
  let data;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('The service returned an unreadable response.'); }
  if (!response.ok) throw Object.assign(new Error(typeof data.error === 'string' ? data.error.slice(0, 500) : 'The service is unavailable. Try again later.'), { status: response.status });
  return data;
}
async function loadPublicReports() {
  let after = '', size = 0; const reports = [], seen = new Set();
  do {
    const page = await jsonFetch(intakeOrigin + '/api/reports' + (after ? '?after=' + after : ''));
    size += new TextEncoder().encode(JSON.stringify(page)).length;
    if (size > 16000000) throw new Error('Registry exceeds browser limit.');
    reports.push(...validateRegistry({ schemaVersion: page.schemaVersion, reports: page.reports }).reports);
    after = page.nextCursor || '';
    if (after && (!/^[a-f0-9]{32}$/.test(after) || seen.has(after))) throw new Error('Invalid registry pagination.');
    seen.add(after); if (reports.length > 20000) throw new Error('Registry exceeds report limit.');
  } while (after);
  return { schemaVersion: 1, reports };
}
async function load() {
  if (loading) return;
  loading = true; $('retry-load').disabled = true; render();
  const results = await Promise.allSettled(intakeEnabled ? [jsonFetch('data/reports.json'), loadPublicReports()] : [jsonFetch('data/reports.json')]);
  const combined = new Map(); let failures = 0;
  for (const result of results) {
    try {
      if (result.status !== 'fulfilled') throw new Error();
      const valid = validateRegistry(result.value);
      for (const entry of valid.reports) if (!combined.has(entry.report.reportId)) combined.set(entry.report.reportId, entry);
    } catch { failures++; }
  }
  entries = [...combined.values()]; loading = false;
  dataState = failures === results.length ? 'unavailable' : failures ? 'partial' : 'ready';
  $('load-error').hidden = !failures; $('load-error').classList.toggle('error', dataState === 'unavailable');
  $('load-error-text').textContent = dataState === 'unavailable' ? 'Reports could not be loaded. This is not a zero-report result.'
    : 'Some report sources are unavailable. The results below may be incomplete.';
  $('retry-load').disabled = false;
  for (const key of ['version', 'runtime']) {
    const selected = $(key).value, placeholder = key === 'version' ? 'All versions' : 'All runtimes';
    const values = [...new Set(entries.map(e => key === 'version' ? e.report.uifVersion : e.report.evidence.runtime))].sort();
    $(key).replaceChildren(option('', placeholder), ...values.map(value => option(value)));
    setSelect(key, selected);
  }
  render(); applyRoute();
}
$('retry-load').addEventListener('click', load);

function resetDraft(mode = entryMode) {
  importGeneration++; imported = null; draft = newDraft(); draftDirty = false; entryMode = mode;
  $('submission-layout').hidden = false; $('entry-mode').hidden = false;
  if (lastReceipt) $('receipt-heading').textContent = 'Previous submission';
  $('submission').reset(); for (const id of identityFields) $(id).disabled = false;
  for (const radio of document.querySelectorAll('[name=entry-mode]')) radio.checked = radio.value === mode;
  $('import-area').hidden = mode !== 'import'; $('clear-import').hidden = true;
  $('report-fields').hidden = mode === 'import'; $('report-fields').disabled = mode === 'import';
  $('import-status').textContent = ''; $('submission-status').textContent = intakeEnabled ? '' : 'Public submissions are not enabled. Saving a report and the optional GitHub form are still available.';
  $('send').disabled = !intakeEnabled; $('preview').textContent = mode === 'import' ? 'No report selected.' : 'Enter build details to preview the public report.';
}
$('entry-mode').addEventListener('change', e => {
  if (sending) return;
  const mode = e.target.value;
  if (mode === entryMode) return;
  if (draftDirty && !confirm('Switch entry method and clear this draft? Saved submission receipts will remain available.')) {
    for (const radio of document.querySelectorAll('[name=entry-mode]')) radio.checked = radio.value === entryMode;
    return;
  }
  resetDraft(mode);
});
$('clear-import').addEventListener('click', () => {
  if (!draftDirty || confirm('Remove this imported report and clear its draft?')) { resetDraft('import'); $('report-file').focus(); }
});
function buildReport() {
  if (entryMode === 'import' && !imported) throw new Error('Choose a UIF compatibility report first.');
  const r = structuredClone(imported || draft);
  Object.assign(r, { gameName: $('game-name').value.trim(), console: $('report-system').value,
    uifVersion: $('uif-version').value.trim(), environment: $('report-environment').value, baseName: $('base-name').value.trim(),
    gameRegion: $('region').value.trim(), gameRevision: $('revision').value.trim(), gameId: $('game-id').value.trim(),
    outputMode: $('report-output').value, outcome: document.querySelector('[name=result]:checked')?.value || '',
    notes: $('notes').value, checks: Object.fromEntries(checkNames.map(key => [key, $('check-' + key).value])) });
  const runtime = $('report-runtime').value.trim();
  if (imported && (runtime !== r.evidence.runtime || r.baseName !== imported.baseName || r.console !== imported.console
    || r.uifVersion !== imported.uifVersion || r.gameName !== imported.gameName || r.gameId !== imported.gameId || r.outputMode !== imported.outputMode))
    throw new Error('Imported build identity must match its captured evidence. Remove the import to enter another build.');
  r.evidence.runtime = runtime; return validateReport(r);
}
function preview() { try { $('preview').textContent = JSON.stringify(buildReport(), null, 2); } catch (error) { $('preview').textContent = error.message; } }
$('submission').addEventListener('input', () => { draftDirty = true; $('consent').checked = false; preview(); });
$('consent').addEventListener('input', e => e.stopPropagation());
$('report-file').addEventListener('change', async () => {
  const generation = ++importGeneration;
  imported = null; $('consent').checked = false; $('report-fields').hidden = true; $('report-fields').disabled = true;
  $('clear-import').hidden = true;
  const file = $('report-file').files[0];
  if (!file) { resetDraft('import'); return; }
  $('import-status').textContent = 'Checking report...';
  try {
    if (file.size > 65536) throw new Error('Use a compatibility JSON report of 64 KiB or less, not a support bundle.');
    const parsed = JSON.parse(await file.text()); if (generation !== importGeneration) return;
    if (parsed.receipt && !parsed.reportId) throw new Error('This file is a submission receipt. Use Status to check that submission.');
    const r = validateReport(parsed); imported = r; draftDirty = true;
    for (const [id, value] of Object.entries({ 'game-name': r.gameName, 'report-system': r.console, 'uif-version': r.uifVersion,
      'base-name': r.baseName, 'report-runtime': r.evidence.runtime, 'report-environment': r.environment, region: r.gameRegion,
      revision: r.gameRevision, 'game-id': r.gameId, 'report-output': r.outputMode, notes: r.notes })) $(id).value = value;
    for (const id of identityFields) $(id).disabled = true;
    document.querySelector('[name=result][value="' + r.outcome + '"]').checked = true;
    for (const key of checkNames) $('check-' + key).value = r.checks[key] || 'Not tested';
    $('report-fields').hidden = false; $('report-fields').disabled = false; $('clear-import').hidden = false;
    $('import-status').textContent = 'Imported ' + r.gameName + '. Captured build identity is preserved.';
    preview();
  } catch (error) {
    if (generation === importGeneration) { $('import-status').textContent = 'Import failed: ' + error.message; $('report-file').value = ''; $('preview').textContent = 'No valid report selected.'; }
  }
});
$('export').addEventListener('click', () => {
  try { download(buildReport(), 'uif-compatibility-report.json'); $('submission-status').textContent = 'Report saved on this device. Nothing was uploaded.'; }
  catch (error) { $('submission-status').textContent = error.message; }
});
function setSending(value) {
  sending = value; $('submission-controls').disabled = value; $('entry-mode').disabled = value;
  $('stop-waiting').hidden = !value; $('submission').setAttribute('aria-busy', String(value));
}
async function solve(challenge, signal) {
  if (typeof challenge !== 'string' || !/^\d{13}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(challenge)) throw new Error('Invalid browser verification. Try again later.');
  for (let i = 0; i < 2000000; i++) {
    signal.throwIfAborted();
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(challenge + '.' + i)));
    if (bytes[0] === 0 && bytes[1] < 16) return i;
    if (i % 200 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('Browser verification timed out. Please try again.');
}
$('stop-waiting').addEventListener('click', () => submissionController?.abort());
$('submission').addEventListener('submit', async e => {
  e.preventDefault(); if (!intakeEnabled || sending || !$('consent').checked) return;
  let report; try { report = buildReport(); } catch (error) { $('submission-status').textContent = error.message; return; }
  submissionController = new AbortController(); const signal = submissionController.signal;
  let postStarted = false;
  setSending(true); $('submission-status').textContent = 'Checking submission...';
  try {
    const { challenge } = await jsonFetch(intakeOrigin + '/api/challenge', { signal, limit: 2048 });
    const proof = await solve(challenge, signal); $('submission-status').textContent = 'Sending for review...';
    postStarted = true;
    const result = await jsonFetch(intakeOrigin + '/api/submissions', { method: 'POST', signal, limit: 4096,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report, consent: true, website: $('website').value, challenge, proof }) });
    if (!/^[a-f0-9]{32}$/.test(result.receipt)) throw new Error('The service did not return a valid receipt.');
    lastReceipt = { schemaVersion: 1, receipt: result.receipt, statusUrl: statusLink(publicSite, result.receipt), savedAtUtc: new Date().toISOString() };
    $('receipt-id').textContent = result.receipt;
    $('receipt-heading').textContent = result.duplicate ? 'Report already received' : 'Submission received';
    $('receipt-summary').textContent = result.duplicate ? 'This exact report was already received. Check its status with the same private receipt.'
      : 'Your report is awaiting review. It is not public until approved.';
    $('receipt-link').href = '#status?receipt=' + result.receipt;
    $('receipt-feedback').textContent = ''; $('receipt-panel').hidden = false;
    $('submission-status').textContent = result.duplicate ? 'This exact report was already received.' : 'Received. Your report is awaiting review.';
    $('consent').checked = false; $('receipt-heading').focus({ preventScroll: true });
    $('submission-layout').hidden = true; $('entry-mode').hidden = true;
    $('receipt-panel').scrollIntoView({ block: 'start' });
  } catch (error) {
    $('submission-status').textContent = (signal.aborted ? 'Stopped waiting. Receipt confirmation was not received.' : 'Not confirmed: ' + error.message)
      + (postStarted ? ' The report may have arrived. Your entries are still here; retrying identical contents will not create a duplicate.'
        : ' No report was sent. Your entries are still here and you can retry.');
  } finally { setSending(false); submissionController = null; }
});
$('copy-receipt').addEventListener('click', () => { if (lastReceipt) copyLink(lastReceipt.statusUrl, 'receipt-feedback'); });
$('save-receipt').addEventListener('click', () => { if (lastReceipt) { download(lastReceipt, 'uif-submission-receipt.json'); $('receipt-feedback').textContent = 'Private receipt saved on this device.'; } });
$('new-report').addEventListener('click', () => {
  if (sending) return;
  resetDraft(); $('submission-status').textContent = 'New report started. Your last receipt is still available above.';
  (entryMode === 'import' ? $('report-file') : $('game-name')).focus();
});
async function lookupReceipt(value) {
  const generation = ++statusGeneration;
  statusController?.abort(); statusController = new AbortController();
  let receipt;
  try { receipt = parseReceipt(value, intakeOrigin); } catch (error) { $('lookup-message').textContent = error.message; $('status-result').hidden = true; $('lookup-status').disabled = false; $('refresh-status').disabled = false; return; }
  currentReceipt = receipt; $('receipt-input').value = receipt;
  $('lookup-status').disabled = true; $('refresh-status').disabled = true; $('status-result').hidden = true;
  $('lookup-message').textContent = 'Checking submission status...';
  history.replaceState(null, '', '#status?receipt=' + receipt);
  try {
    const result = await jsonFetch(intakeOrigin + '/api/receipts/' + receipt, { signal: statusController.signal, limit: 2048 });
    if (generation !== statusGeneration) return;
    const states = { pending: ['Awaiting review', 'Your report is in the private review queue. It is not public yet.'],
      approved: ['Published', 'Your report has been approved for the public compatibility list.'],
      rejected: ['Not published or removed', 'This report was rejected or removed. Its submitted contents have been erased from active storage.'] };
    if (!states[result.status]) throw new Error('The service returned an unknown review status.');
    $('status-result-heading').textContent = states[result.status][0]; $('status-description').textContent = states[result.status][1];
    $('lookup-message').textContent = ''; $('status-result').hidden = false;
  } catch (error) {
    if (generation === statusGeneration) $('lookup-message').textContent = error.status === 404
      ? 'Receipt not found or expired. Check the receipt or status link.'
      : 'Status could not be checked. This does not mean the report was rejected. Try again later.';
  } finally {
    if (generation === statusGeneration) { $('lookup-status').disabled = false; $('refresh-status').disabled = false; }
  }
}
$('status-form').addEventListener('submit', e => { e.preventDefault(); lookupReceipt($('receipt-input').value); });
$('refresh-status').addEventListener('click', () => { if (currentReceipt) lookupReceipt(currentReceipt); });
resetDraft('import'); applyRoute(); load();
