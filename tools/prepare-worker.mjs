import { mkdir, copyFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url), destination = new URL('outputs/worker-assets/', root);
for (const [source, target] of [['worker/review.html', 'review.html'], ['worker/review.mjs', 'review.mjs'], ['worker/review.css', 'review.css'],
  ['site/style.css', 'style.css'], ['site/registry.mjs', 'registry.mjs'], ['site/assets/uinjectforge-icon.png', 'assets/uinjectforge-icon.png'], ['site/assets/refresh.svg', 'assets/refresh.svg']]) {
  const file = new URL(target, destination); await mkdir(new URL('./', file), { recursive: true }); await copyFile(new URL(source, root), file);
}
console.log('Prepared seven explicit public reviewer assets. No private data or credentials copied.');
