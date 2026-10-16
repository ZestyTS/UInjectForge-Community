import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRegistry } from '../site/registry.mjs';
import { report } from './fixtures.mjs';
test('reviewed public-form entries do not need a GitHub identity or issue',()=>{
 const entry={report:report(),review:{reviewer:'UIF community moderation',reviewedAtUtc:'2026-10-16T12:00:00Z',issueUrl:''}};
 assert.equal(validateRegistry({schemaVersion:1,reports:[entry]}).reports.length,1);
 entry.review.issueUrl='https://evil.test/';assert.throws(()=>validateRegistry({schemaVersion:1,reports:[entry]}));
});
test('public form has explicit consent, no-account path, private-data warning and accessible fields',()=>{
 const html=readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
 assert.match(html,/No GitHub account required/);assert.match(html,/id="consent"[^>]*required/);assert.match(html,/support bundles/);assert.match(html,/aria-label="Filter by system"/);assert.match(html,/id="report-file"/);
 assert.doesNotMatch(html,/https:\/\/.*(?:unpkg|jsdelivr|google-analytics)/);
});
