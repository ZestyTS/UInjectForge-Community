import { compareVersions, versionParts } from './release.mjs';

export const catalogLimits = Object.freeze({ bytes: 262144, depth: 8, entries: 64, sections: 16,
  itemsPerSection: 128, totalItems: 2048, version: 64, title: 256, item: 4096, announcement: 32768 });
const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const fail = message => { throw new Error(message); };
function text(value, limit, nonempty = true) {
  if (typeof value !== 'string' || value.length > limit || controls.test(value)
    || (nonempty && (!value.trim() || value.trim() !== value))) fail('Invalid release text.');
}
function object(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || required.some(key => !Object.hasOwn(value, key))
    || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail('Invalid release fields.');
}
function validDate(value) {
  return typeof value === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) && value.slice(0, 4) !== '0000'
    && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
    && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}
function inspectJson(text) {
  const stack = [];
  // JSON.parse below owns syntax validation. This pass also rejects duplicate
  // property names before JSON.parse can silently discard the earlier value.
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      const start = index++;
      for (; index < text.length; index++) {
        if (text[index] === '\\') index++;
        else if (text[index] === '"') break;
      }
      const frame = stack.at(-1);
      if (frame?.keys && frame.expectKey) {
        const key = JSON.parse(text.slice(start, index + 1));
        if (frame.keys.has(key)) fail('Duplicate release field.');
        frame.keys.add(key); frame.expectKey = false;
      }
    } else if (char === '{' || char === '[') {
      stack.push(char === '{' ? { keys: new Set(), expectKey: true } : {});
      if (stack.length > catalogLimits.depth) fail('Release catalog exceeds its depth limit.');
    } else if (char === '}' || char === ']') stack.pop();
    else if (char === ',' && stack.at(-1)?.keys) stack.at(-1).expectKey = true;
  }
}

export function parseReleaseCatalog(raw) {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > catalogLimits.bytes) fail('Release catalog exceeds 256 KiB.');
  inspectJson(raw);
  return validateReleaseCatalog(JSON.parse(raw));
}

export function validateReleaseCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length > catalogLimits.entries) fail('Invalid release catalog.');
  const versions = new Set(); let itemCount = 0;
  for (const entry of catalog) {
    object(entry, ['version', 'date', 'sections'], ['title', 'announcementMarkdown']);
    text(entry.version, catalogLimits.version); versionParts(entry.version);
    if (versions.has(entry.version)) fail('Duplicate release version.');
    versions.add(entry.version);
    if (entry.date !== null && !validDate(entry.date)) fail('Invalid release date.');
    if (Object.hasOwn(entry, 'title')) text(entry.title, catalogLimits.title);
    if (Object.hasOwn(entry, 'announcementMarkdown')) text(entry.announcementMarkdown, catalogLimits.announcement, false);
    if (!Array.isArray(entry.sections) || entry.sections.length < 1 || entry.sections.length > catalogLimits.sections) fail('Invalid release sections.');
    for (const section of entry.sections) {
      object(section, ['title', 'items']); text(section.title, catalogLimits.title);
      if (!Array.isArray(section.items) || section.items.length < 1 || section.items.length > catalogLimits.itemsPerSection) fail('Invalid release items.');
      itemCount += section.items.length;
      if (itemCount > catalogLimits.totalItems) fail('Too many release items.');
      for (const item of section.items) text(item, catalogLimits.item);
    }
  }
  if (new TextEncoder().encode(JSON.stringify(catalog)).length > catalogLimits.bytes) fail('Release catalog exceeds 256 KiB.');
  return catalog;
}

export function publishedReleaseCatalog(catalog, stableVersion) {
  validateReleaseCatalog(catalog); versionParts(stableVersion);
  return catalog.filter(entry => entry.date !== null && compareVersions(entry.version, stableVersion) <= 0);
}

export function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function inlineHtml(value) {
  let result = '', offset = 0;
  for (const match of value.matchAll(/`([^`\n]+)`|\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g)) {
    result += escapeHtml(value.slice(offset, match.index));
    if (match[1] !== undefined) result += '<code>' + escapeHtml(match[1]) + '</code>';
    else {
      let url;
      try { url = new URL(match[3]); } catch { /* Keep malformed links as escaped text. */ }
      result += url?.protocol === 'https:' && !url.username && !url.password
        ? '<a href="' + escapeHtml(url.href) + '" rel="noopener noreferrer">' + escapeHtml(match[2]) + '</a>' : escapeHtml(match[0]);
    }
    offset = match.index + match[0].length;
  }
  return result + escapeHtml(value.slice(offset));
}
function narrativeHtml(markdown) {
  const blocks = []; let paragraph = [], list = [];
  function flush() {
    if (paragraph.length) { blocks.push('<p>' + inlineHtml(paragraph.join('\n')) + '</p>'); paragraph = []; }
    if (list.length) { blocks.push('<ul>' + list.map(item => '<li>' + inlineHtml(item) + '</li>').join('') + '</ul>'); list = []; }
  }
  for (const line of markdown.replaceAll('\r\n', '\n').split('\n')) {
    const heading = /^(#{1,6}) (.+)$/.exec(line), bullet = /^[-*] (.+)$/.exec(line);
    if (!line.trim()) flush();
    else if (heading) { flush(); blocks.push('<h' + heading[1].length + '>' + inlineHtml(heading[2]) + '</h' + heading[1].length + '>'); }
    else if (bullet) { if (paragraph.length) flush(); list.push(bullet[1]); }
    else { if (list.length) flush(); paragraph.push(line); }
  }
  flush(); return blocks.join('\n');
}

export function announcementArtifacts(entry) {
  validateReleaseCatalog([entry]);
  const title = entry.title ?? 'UInjectForge ' + entry.version;
  const narrative = entry.announcementMarkdown ?? '';
  const sections = entry.sections.map(section => '### ' + section.title + '\n\n'
    + section.items.map(item => '- ' + item.replaceAll('\n', '\n  ')).join('\n')).join('\n\n');
  const markdown = ((narrative ? narrative.replace(/\s+$/, '') + '\n\n' : '') + '## TL;DR\n\n' + sections + '\n')
    .replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const html = (narrative ? narrativeHtml(narrative) + '\n' : '') + '<h2>TL;DR</h2>\n'
    + entry.sections.map(section => '<h3>' + escapeHtml(section.title) + '</h3>\n<ul>'
      + section.items.map(item => '<li>' + escapeHtml(item) + '</li>').join('') + '</ul>').join('\n') + '\n';
  return { title, markdown, html };
}
