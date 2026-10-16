import { readFile, writeFile } from 'node:fs/promises';
import { validateReport, validateRegistry } from '../site/registry.mjs';
// Run only after human privacy/provenance review. It never evaluates input code.
const [input, issue, reviewer] = process.argv.slice(2);
if (!input || !issue || !reviewer) throw new Error('Usage: node tools/review.mjs report.json https://github.com/ZestyTS/UInjectForge-Community/issues/NUMBER reviewer');
const body = await readFile(input);
if (body.length > 65536) throw new Error('Report exceeds 64 KiB.');
const report = validateReport(JSON.parse(body));
const path = new URL('../site/data/reports.json', import.meta.url);
const registry = validateRegistry(JSON.parse(await readFile(path, 'utf8')));
registry.reports.push({ report, review: { reviewer, reviewedAtUtc: new Date().toISOString(), issueUrl: issue } });
validateRegistry(registry);
// Exclusive temp creation avoids overwriting another reviewer's intermediate file.
const temp = new URL(`../site/data/reports.${process.pid}.tmp`, import.meta.url);
await writeFile(temp, JSON.stringify(registry, null, 2) + '\n', { flag: 'wx' });
const { rename } = await import('node:fs/promises');
await rename(temp, path);
console.log('Added reviewed report. Inspect the diff, run tests, then open a public-repository pull request.');
