export const issueUrl = 'https://github.com/ZestyTS/UInjectForge-Community/issues/new?template=compatibility.yml';
export const systems = ['Nes', 'Snes', 'N64', 'Nds', 'Gba', 'Tg16', 'Psp', 'Sega', 'Msx', 'Wii', 'Gcn'];
export const labels = { Nes: 'NES', Snes: 'SNES', N64: 'Nintendo 64', Nds: 'Nintendo DS', Gba: 'Game Boy Advance', Tg16: 'TurboGrafx-16', Psp: 'PSP', Sega: 'Sega', Msx: 'MSX', Wii: 'Wii', Gcn: 'GameCube' };
const fingerprintNames = ['RuntimeSha256', 'RuntimePackagedSha256', 'RuntimeConfigSha256', 'CoreOptionsSha256', 'SourceGameSha256', 'WiiRemoteProfileSha256'];
const checkNames = ['boot', 'controls', 'audio', 'video', 'save', 'manual'];
const checkValues = ['Pass', 'Issues', 'Fail', 'Not tested'];
function requireValue(ok, message) { if (!ok) throw new Error(message); }
function object(value, keys, name) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), `${name} must be an object.`);
  requireValue(Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)), `${name} has missing or unexpected fields.`);
}
function text(value, limit, name, required = false) {
  requireValue(typeof value === 'string' && value.length <= limit && !/[\x00-\x08\x0b-\x1f\x7f]/.test(value) && (!required || value.trim()), `${name} is invalid or too long.`);
}
export function validateReport(r) {
  object(r, ['schemaVersion', 'reportId', 'reportedAtUtc', 'builtAtUtc', 'uifVersion', 'console', 'outputMode', 'gameName', 'gameId', 'gameRegion', 'gameRevision', 'baseName', 'baseTitleId', 'customBase', 'buildSucceeded', 'environment', 'outcome', 'checks', 'notes', 'evidence'], 'Report');
  requireValue(r.schemaVersion === 1, 'Unsupported report version.');
  requireValue(/^[a-f0-9]{32}$/i.test(r.reportId), 'Invalid report ID.');
  for (const key of ['reportedAtUtc', 'builtAtUtc']) requireValue(typeof r[key] === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(r[key]) && Number.isFinite(Date.parse(r[key])), `Invalid ${key}.`);
  for (const key of ['gameName', 'gameId', 'baseName']) text(r[key], 200, key, key !== 'gameId');
  text(r.uifVersion, 120, 'UIF version', true);
  text(r.gameRegion, 40, 'Region'); text(r.gameRevision, 80, 'Revision'); text(r.notes, 4000, 'Notes');
  requireValue(systems.includes(r.console), 'Unknown system.');
  requireValue(['WorkspaceOnly', 'Installable', 'Loadiine'].includes(r.outputMode), 'Unknown output mode.');
  requireValue(['Unknown', 'Aroma', 'Tiramisu', 'Other'].includes(r.environment), 'Unknown console environment.');
  requireValue(['Works', 'Issues', 'Broken'].includes(r.outcome), 'Choose a tested outcome; unrated is not a compatibility result.');
  requireValue(typeof r.customBase === 'boolean' && (r.buildSucceeded === null || typeof r.buildSucceeded === 'boolean'), 'Invalid build status.');
  requireValue(typeof r.baseTitleId === 'string' && /^(?:[a-f0-9]{16})?$/i.test(r.baseTitleId), 'Invalid base title ID.');
  requireValue(r.checks && typeof r.checks === 'object' && !Array.isArray(r.checks), 'Invalid checks.');
  requireValue(Object.entries(r.checks).every(([k, v]) => checkNames.includes(k) && checkValues.includes(v)), 'Unknown test check or result.');
  object(r.evidence, ['runtime', 'settings', 'fingerprints', 'omittedOptions', 'scope'], 'Evidence');
  text(r.evidence.runtime, 100, 'Runtime', true); text(r.evidence.scope, 300, 'Evidence scope', true);
  requireValue(Number.isInteger(r.evidence.omittedOptions) && r.evidence.omittedOptions >= 0, 'Invalid omitted option count.');
  for (const [name, limit] of [['settings', 150], ['fingerprints', 6]]) {
    const values = r.evidence[name];
    requireValue(values && typeof values === 'object' && !Array.isArray(values) && Object.keys(values).length <= limit, `Invalid ${name}.`);
  }
  for (const [key, value] of Object.entries(r.evidence.settings)) {
    requireValue(/^[A-Za-z][A-Za-z0-9.]{0,100}$/.test(key) && !/key|path|folder|root|secret|token|password|json|manifest|snapshot|domain|receipt|approval/i.test(key), 'Private or unrecognized setting field.');
    requireValue(typeof value === 'string' && /^[A-Za-z0-9 _().,+%-]{1,100}$/.test(value), `Invalid setting value: ${key}.`);
  }
  for (const [key, value] of Object.entries(r.evidence.fingerprints))
    requireValue(fingerprintNames.includes(key) && typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value), 'Invalid SHA-256 evidence.');
  requireValue(new TextEncoder().encode(JSON.stringify(r)).length <= 65536, 'Report exceeds 64 KiB.');
  return r;
}
export function validateRegistry(data) {
  object(data, ['schemaVersion', 'reports'], 'Registry');
  requireValue(data.schemaVersion === 1 && Array.isArray(data.reports) && data.reports.length <= 20000, 'Invalid registry.');
  const ids = new Set();
  for (const entry of data.reports) {
    object(entry, ['report', 'review'], 'Registry entry'); validateReport(entry.report);
    requireValue(!ids.has(entry.report.reportId), 'Duplicate report ID.'); ids.add(entry.report.reportId);
    object(entry.review, ['reviewer', 'reviewedAtUtc', 'issueUrl'], 'Review');
    text(entry.review.reviewer, 80, 'Reviewer', true);
    requireValue(Number.isFinite(Date.parse(entry.review.reviewedAtUtc)), 'Invalid review date.');
    requireValue(entry.review.issueUrl === '' || /^https:\/\/github\.com\/ZestyTS\/UInjectForge-Community\/issues\/[1-9][0-9]*$/.test(entry.review.issueUrl), 'Invalid public review link.');
  }
  return data;
}
export function filterReports(entries, { search = '', system = '', outcome = '', environment = '', version = '', runtime = '' } = {}) {
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter(({ report: r }) => (!system || r.console === system) && (!outcome || r.outcome === outcome)
    && (!environment || r.environment === environment) && (!version || r.uifVersion === version) && (!runtime || r.evidence.runtime === runtime)
    && terms.every(t => JSON.stringify(r).toLowerCase().includes(t)));
}
export function submissionText(report) {
  validateReport(report);
  return JSON.stringify(report, null, 2);
}
