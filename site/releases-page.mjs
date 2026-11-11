import { validateStableFeed, compareVersions } from './release.mjs';
import { catalogLimits, parseReleaseCatalog, publishedReleaseCatalog } from './release-catalog.mjs';

const byId = id => document.getElementById(id);
let releases = [];
function node(tag, text, parent) {
  const value = document.createElement(tag);
  if (text !== undefined) value.textContent = text;
  if (parent) parent.append(value);
  return value;
}
function inline(parent, text) {
  const tokens = /`([^`\n]+)`|\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g;
  let offset = 0;
  for (const match of text.matchAll(tokens)) {
    parent.append(document.createTextNode(text.slice(offset, match.index)));
    if (match[1] !== undefined) node('code', match[1], parent);
    else {
      let url;
      try { url = new URL(match[3]); } catch { /* Invalid links remain plain text. */ }
      if (url?.protocol === 'https:' && !url.username && !url.password) {
        const link = node('a', match[2], parent); link.href = url.href; link.rel = 'noopener noreferrer';
      } else parent.append(document.createTextNode(match[0]));
    }
    offset = match.index + match[0].length;
  }
  parent.append(document.createTextNode(text.slice(offset)));
}
function narrative(parent, markdown) {
  let paragraph = [], list = null;
  function flush() {
    if (paragraph.length) { inline(node('p', undefined, parent), paragraph.join('\n')); paragraph = []; }
    list = null;
  }
  for (const line of markdown.replaceAll('\r\n', '\n').split('\n')) {
    const heading = /^(#{1,6}) (.+)$/.exec(line), bullet = /^[-*] (.+)$/.exec(line);
    if (!line.trim()) flush();
    else if (heading) { flush(); inline(node('h' + Math.max(2, heading[1].length), undefined, parent), heading[2]); }
    else if (bullet) { if (paragraph.length) flush(); list ??= node('ul', undefined, parent); inline(node('li', undefined, list), bullet[1]); }
    else { list = null; paragraph.push(line); }
  }
  flush();
}
function render() {
  const selected = releases.find(entry => entry.version === location.hash.slice(1)) ?? releases[0];
  byId('release-versions').replaceChildren(); byId('release-content').replaceChildren();
  if (!selected) return;
  for (const entry of releases) {
    const link = node('a', 'UIF ' + entry.version, byId('release-versions'));
    link.href = '#' + entry.version;
    if (entry === selected) link.setAttribute('aria-current', 'page');
  }
  const article = byId('release-content');
  node('h2', selected.title ?? 'UInjectForge ' + selected.version, article);
  const time = node('time', selected.date, article); time.dateTime = selected.date;
  if (selected.announcementMarkdown) narrative(node('div', undefined, article), selected.announcementMarkdown);
  node('h2', 'TL;DR', article);
  for (const section of selected.sections) {
    node('h3', section.title, article);
    const list = node('ul', undefined, article);
    for (const item of section.items) node('li', item, list);
  }
}
async function boundedText(path, limit, signal) {
  const response = await fetch(path, { redirect: 'error', cache: 'no-store', signal });
  if (!response.ok || Number(response.headers.get('content-length')) > limit) throw new Error('Release history unavailable.');
  const reader = response.body.getReader(), chunks = []; let length = 0;
  while (true) {
    const part = await reader.read(); if (part.done) break;
    length += part.value.byteLength;
    if (length > limit) { await reader.cancel(); throw new Error('Release history exceeds its limit.'); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
async function load() {
  byId('release-retry').hidden = true; byId('release-status').textContent = 'Loading release history…';
  try {
    const signal = AbortSignal.timeout(10000);
    const [rawFeed, rawCatalog] = await Promise.all([
      boundedText('updates/stable.json', 2048, signal), boundedText('updates/releases.json', catalogLimits.bytes, signal)
    ]);
    const feed = validateStableFeed(JSON.parse(rawFeed));
    releases = publishedReleaseCatalog(parseReleaseCatalog(rawCatalog), feed.version)
      .slice().sort((a, b) => compareVersions(b.version, a.version));
    byId('release-status').textContent = releases.length ? '' : 'No release history has been published yet.';
    render();
  } catch {
    byId('release-status').textContent = 'Release history is unavailable. Please try again.';
    byId('release-retry').hidden = false;
  }
}
addEventListener('hashchange', render);
byId('release-retry').addEventListener('click', load);
load();
