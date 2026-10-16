import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReport, validateRegistry, filterReports, submissionText } from '../site/registry.mjs';
export function report() { return { schemaVersion: 1, reportId: 'a'.repeat(32), reportedAtUtc: '2026-10-16T00:00:00Z', builtAtUtc: '2026-10-15T00:00:00Z',
  uifVersion: '1.0.6+abc', console: 'Nds', outputMode: 'Installable', gameName: 'Authored test fixture', gameId: 'Test-01', gameRegion: 'USA', gameRevision: '', baseName: 'Test base', baseTitleId: '0005000012345678', customBase: false, buildSucceeded: true, environment: 'Aroma', outcome: 'Works', checks: { boot: 'Pass', save: 'Not tested' }, notes: 'Fixture only, never published.',
  evidence: { runtime: 'NooDSAutoboot', settings: { 'nds.noods.frameskip': '1' }, fingerprints: { RuntimeSha256: 'A'.repeat(64) }, omittedOptions: 2, scope: 'Recorded inputs, not independent hardware verification.' } }; }
function entry(r = report()) { return { report: r, review: { reviewer: 'test-reviewer', reviewedAtUtc: '2026-10-16T01:00:00Z', issueUrl: 'https://github.com/ZestyTS/UInjectForge-Community/issues/1' } }; }
test('accepts exact UIF schema and preserves unknown checks', () => { const r = validateReport(report()); assert.equal(r.checks.save, 'Not tested'); assert.ok(!Object.hasOwn(r.checks, 'manual')); assert.deepEqual(JSON.parse(submissionText(r)), r); });
for (const key of ['romPath', 'keys', 'manifestPath', 'review', '__proto__']) test(`rejects extra field ${key}`, () => { const r = report(); Object.defineProperty(r, key, { value: 'private', enumerable: true }); assert.throws(() => validateReport(r)); });
for (const key of ['base.titleKey', 'nds.noodsRuntimePath', 'wii.commonKey', 'secretToken']) test(`rejects private setting ${key}`, () => { const r = report(); r.evidence.settings[key] = 'secret'; assert.throws(() => validateReport(r)); });
for (const mutate of [r => r.outcome = 'Unrated', r => r.evidence.fingerprints.RuntimeSha256 = 'md5', r => r.notes = 'x'.repeat(4001), r => r.schemaVersion = 2, r => r.checks.boot = 'guaranteed', r => r.console = 'Unknown', r => r.gameName = null]) test('rejects invalid report ' + mutate.toString(), () => { const r = report(); mutate(r); assert.throws(() => validateReport(r)); });
test('different UIF/runtime/base evidence stays distinct and searchable', () => {
  const a = entry(), b = entry(report()); b.report.reportId = 'b'.repeat(32); b.report.outcome = 'Issues'; b.report.uifVersion = '1.0.5'; b.report.environment = 'Tiramisu'; b.report.evidence.fingerprints.RuntimeSha256 = 'B'.repeat(64);
  const list = validateRegistry({ schemaVersion: 1, reports: [a, b] }).reports;
  assert.equal(filterReports(list).length, 2); assert.equal(filterReports(list, { version: '1.0.5' }).length, 1);
  assert.equal(filterReports(list, { search: 'B'.repeat(64) }).length, 1); assert.equal(filterReports(list, { environment: 'Aroma', outcome: 'Issues' }).length, 0);
  assert.equal(filterReports(list, { system: 'Nds', runtime: 'NooDSAutoboot', search: 'authored USA' }).length, 2);
});
test('review provenance cannot be an arbitrary URL and duplicates fail', () => {
  const e = entry(); e.review.issueUrl = 'javascript:alert(1)'; assert.throws(() => validateRegistry({ schemaVersion: 1, reports: [e] }));
  assert.throws(() => validateRegistry({ schemaVersion: 1, reports: [entry(), entry()] }));
});
test('empty registry is honest and valid', () => assert.deepEqual(validateRegistry({ schemaVersion: 1, reports: [] }).reports, []));
