import { systems } from './registry.mjs';

export const pageSize = 25;
export const filterKeys = ['search', 'system', 'outcome', 'environment', 'version', 'runtime'];
export function readRoute(hash) {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const filters = Object.fromEntries(filterKeys.map(key => [key, (params.get(key) || '').slice(0, key === 'search' ? 200 : 120)]));
  if (!systems.includes(filters.system)) filters.system = '';
  if (!['Works', 'Issues', 'Broken'].includes(filters.outcome)) filters.outcome = '';
  if (!['Aroma', 'Tiramisu', 'Other', 'Unknown'].includes(filters.environment)) filters.environment = '';
  return {
    view: path === 'submit' ? 'submit' : path === 'status' ? 'status' : 'reports',
    reportId: /^report\/[a-f0-9]{32}$/i.test(path) ? path.split('/')[1].toLowerCase() : '',
    receipt: /^[a-f0-9]{32}$/i.test(params.get('receipt') || '') ? params.get('receipt').toLowerCase() : '',
    filters,
    sort: params.get('sort') === 'game' ? 'game' : 'recent',
    page: Math.max(1, Math.min(800, Number.parseInt(params.get('page'), 10) || 1))
  };
}
export function reportsHash(filters, sort = 'recent', page = 1) {
  const query = new URLSearchParams();
  for (const key of filterKeys) if (filters[key]) query.set(key, filters[key]);
  if (sort === 'game') query.set('sort', sort);
  if (page > 1) query.set('page', String(page));
  return '#reports' + (query.size ? '?' + query.toString() : '');
}
export function orderReports(entries, sort) {
  const newest = (a, b) => Date.parse(b.report.reportedAtUtc) - Date.parse(a.report.reportedAtUtc)
    || a.report.reportId.localeCompare(b.report.reportId);
  return [...entries].sort((a, b) => sort === 'game'
    ? a.report.gameName.localeCompare(b.report.gameName, undefined, { sensitivity: 'base' }) || newest(a, b)
    : newest(a, b));
}
export function reportPage(entries, page) {
  const pages = Math.max(1, Math.ceil(entries.length / pageSize));
  const current = Math.max(1, Math.min(pages, page));
  return { entries: entries.slice((current - 1) * pageSize, current * pageSize), current, pages,
    start: entries.length ? (current - 1) * pageSize + 1 : 0, end: Math.min(current * pageSize, entries.length) };
}
export function parseReceipt(value, serviceOrigin) {
  const input = value.trim();
  if (/^[a-f0-9]{32}$/i.test(input)) return input.toLowerCase();
  try {
    const url = new URL(input);
    if (url.username || url.password || url.search) throw new Error();
    if (url.origin === serviceOrigin && /^\/receipt\/[a-f0-9]{32}$/i.test(url.pathname) && !url.hash)
      return url.pathname.split('/').at(-1).toLowerCase();
    const match = /^#status\?receipt=([a-f0-9]{32})$/i.exec(url.hash);
    if (url.origin === 'https://zestyts.github.io' && url.pathname === '/UInjectForge-Community/' && match)
      return match[1].toLowerCase();
  } catch {}
  throw new Error('Enter a 32-character report receipt or its status link.');
}
export function statusLink(baseUrl, receipt) {
  if (!/^[a-f0-9]{32}$/.test(receipt)) throw new Error('Invalid receipt.');
  const url = new URL(baseUrl); url.search = ''; url.hash = 'status?receipt=' + receipt; return url.href;
}
