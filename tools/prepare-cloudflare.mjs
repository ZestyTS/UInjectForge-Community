import { mkdir, writeFile } from 'node:fs/promises';
const values = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  if (!['--database-id', '--origin', '--github-client-id'].includes(process.argv[i]) || !process.argv[i + 1]) throw new Error('Unexpected deployment argument.');
  values.set(process.argv[i], process.argv[i + 1]);
}
const id = values.get('--database-id');
if (!/^[a-f0-9-]{36}$/.test(id || '')) throw new Error('Pass the actual D1 database ID returned by Wrangler.');
const vars = { GITHUB_OWNER_ID: '1396621' };
if (values.has('--origin')) {
  const origin = new URL(values.get('--origin'));
  if (origin.protocol !== 'https:' || origin.origin !== values.get('--origin')) throw new Error('Use the deployed HTTPS origin without a path.');
  vars.SERVICE_ORIGIN = origin.origin;
}
if (values.has('--github-client-id')) vars.GITHUB_CLIENT_ID = values.get('--github-client-id');
const config = { name: 'uinjectforge-community-reports', main: '../../worker/handler.mjs', compatibility_date: '2026-10-16',
  workers_dev: true, preview_urls: false, observability: { enabled: false },
  assets: { directory: '../worker-assets', binding: 'ASSETS', run_worker_first: true }, vars,
  d1_databases: [{ binding: 'DB', database_name: 'uinjectforge-community-reports', database_id: id }] };
const file = new URL('../outputs/cloudflare/wrangler.json', import.meta.url);
await mkdir(new URL('./', file), { recursive: true }); await writeFile(file, JSON.stringify(config, null, 2) + '\n');
console.log('Prepared ignored Cloudflare deployment configuration. Secrets and the account ID are not in source.');
