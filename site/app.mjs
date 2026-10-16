import { issueUrl, systems, labels, validateReport, validateRegistry, filterReports, submissionText } from './registry.mjs';
const $ = id => document.getElementById(id);
let entries = [], selectedReport = null, importGeneration = 0;
function option(value, label = value) { const e = document.createElement('option'); e.value = value; e.textContent = label; return e; }
for (const system of systems) $('system').append(option(system, labels[system]));
function text(tag, value) { const e = document.createElement(tag); e.textContent = value; return e; }
function fact(list, key, value) { list.append(text('dt', key), text('dd', String(value))); }
function showDetail(entry) {
  const r = entry.report;
  $('detail-title').textContent = r.gameName;
  $('detail-scope').textContent = r.evidence.scope;
  const list = document.createElement('dl');
  for (const [k, v] of Object.entries({ System: labels[r.console], Outcome: r.outcome, 'UIF build': r.uifVersion, 'Built at': r.builtAtUtc, 'Reported at': r.reportedAtUtc,
    Environment: r.environment, 'Game identifier': r.gameId || 'Unknown', Region: r.gameRegion || 'Unknown', Revision: r.gameRevision || 'Unknown',
    Base: r.baseName, 'Base title ID': r.baseTitleId || 'Unknown', 'Custom base': r.customBase ? 'Yes' : 'No',
    Output: r.outputMode, 'Build succeeded': r.buildSucceeded === null ? 'Unknown' : r.buildSucceeded ? 'Yes' : 'No',
    Reviewer: entry.review.reviewer })) fact(list, k, v);
  $('detail-facts').replaceChildren(list); $('detail-checks').replaceChildren();
  for (const key of ['boot', 'controls', 'audio', 'video', 'save', 'manual']) fact($('detail-checks'), key, r.checks[key] || 'Not tested');
  $('detail-json').textContent = JSON.stringify(r.evidence, null, 2);
  $('detail-notes').textContent = r.notes || 'No notes.';
  $('detail-source').href = entry.review.issueUrl;
  $('detail').showModal();
}
function render() {
  const filters = Object.fromEntries(['search', 'system', 'outcome', 'environment', 'version', 'runtime'].map(k => [k, $(k).value]));
  const results = filterReports(entries, filters);
  $('count').textContent = `${results.length} report${results.length === 1 ? '' : 's'}${entries.length !== results.length ? ` of ${entries.length}` : ''}`;
  const rows = results.map(entry => {
    const r = entry.report, row = document.createElement('tr');
    const game = text('td', r.gameName); game.append(text('small', `${labels[r.console]}${r.gameRegion ? ` / ${r.gameRegion}` : ''}`));
    const outcome = document.createElement('td'), badge = text('span', r.outcome); badge.className = `badge ${r.outcome.toLowerCase()}`; outcome.append(badge);
    const base = text('td', r.baseName); base.append(text('small', r.evidence.runtime));
    const build = text('td', r.uifVersion); build.append(text('small', r.environment));
    const action = document.createElement('td'), button = text('button', 'Details'); button.type = 'button'; button.addEventListener('click', () => showDetail(entry)); action.append(button);
    base.dataset.label = 'Base / Runtime'; build.dataset.label = 'UIF / Environment';
    row.append(game, outcome, base, build, action); return row;
  });
  $('rows').replaceChildren(...rows); $('empty').hidden = results.length !== 0;
  $('empty').querySelector('h2').textContent = entries.length ? 'No matching reports' : 'No reports yet';
  $('empty').querySelector('p').textContent = entries.length ? 'Change or clear the filters to see other reports.' : 'No public UIF reports have been accepted into this registry. Existing lists are reference material, not proof of a UIF build.';
}
$('filters').addEventListener('submit', e => e.preventDefault());
$('filters').addEventListener('input', render);
$('filters').addEventListener('reset', () => setTimeout(render, 0));
$('close-detail').addEventListener('click', () => $('detail').close());
async function load() {
  try {
    const response = await fetch('data/reports.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('Registry could not be loaded.');
    const body = await response.text(); if (body.length > 16000000) throw new Error('Registry exceeds its size limit.');
    entries = validateRegistry(JSON.parse(body)).reports.sort((a, b) => b.report.reportedAtUtc.localeCompare(a.report.reportedAtUtc));
    for (const field of ['version', 'runtime']) {
      const values = [...new Set(entries.map(e => field === 'version' ? e.report.uifVersion : e.report.evidence.runtime))].sort();
      $(field).append(...values.map(value => option(value)));
    }
    render();
  } catch { $('count').textContent = 'Registry unavailable'; $('load-error').hidden = false; $('load-error').textContent = 'Unable to load validated reports. Please try again later. This is not a zero-report result.'; }
}
function consentChanged() {
  const allowed = Boolean(selectedReport && $('consent').checked);
  $('copy').disabled = !allowed; $('issue').classList.toggle('disabled', !allowed); $('issue').setAttribute('aria-disabled', String(!allowed));
  $('issue').tabIndex = allowed ? 0 : -1;
  if (allowed) $('issue').href = issueUrl; else $('issue').removeAttribute('href');
}
$('consent').addEventListener('change', consentChanged);
$('report-file').addEventListener('change', async () => {
  const generation = ++importGeneration;
  selectedReport = null; $('consent').checked = false; $('consent').disabled = true; consentChanged(); $('preview').textContent = 'No report selected.'; $('copy-status').textContent = '';
  const file = $('report-file').files[0]; if (!file) { $('import-status').textContent = 'No report selected.'; return; }
  try {
    if (file.size > 65536) throw new Error('Select a UIF compatibility report of 64 KiB or less, not a support bundle.');
    const body = await file.text(); if (generation !== importGeneration) return;
    const report = validateReport(JSON.parse(body));
    selectedReport = report; $('preview').textContent = submissionText(report); $('consent').disabled = false;
    $('import-status').textContent = `${report.gameName} / ${report.outcome} / UIF ${report.uifVersion}. Review every field before publishing.`;
  } catch (error) { if (generation === importGeneration) $('import-status').textContent = error.message; }
});
$('copy').addEventListener('click', async () => {
  if (!selectedReport || !$('consent').checked) return;
  try { await navigator.clipboard.writeText(submissionText(selectedReport)); $('copy-status').textContent = 'Report copied. Open the GitHub form and paste it into the JSON field.'; }
  catch { $('copy-status').textContent = 'Clipboard unavailable. Select and copy the preview text instead.'; }
});
load();
