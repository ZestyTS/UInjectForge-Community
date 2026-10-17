export const downloadUrl = 'https://zestyts.itch.io/uinjectforge';

export function versionParts(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d{0,9})\.(0|[1-9]\d{0,9})\.(0|[1-9]\d{0,9})$/.test(version))
    throw new Error('Expected a stable major.minor.patch version.');
  const parts = version.split('.').map(Number);
  if (parts.some(part => part > 2147483647)) throw new Error('Version component is too large.');
  return parts;
}

export function compareVersions(left, right) {
  const a = versionParts(left), b = versionParts(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  return 0;
}

export function validateStableFeed(feed) {
  if (!feed || typeof feed !== 'object' || Array.isArray(feed) || feed.schemaVersion !== 1
    || feed.downloadUrl !== downloadUrl || Object.keys(feed).some(key => !['schemaVersion', 'version', 'downloadUrl'].includes(key)))
    throw new Error('Invalid stable update feed.');
  versionParts(feed.version);
  return { schemaVersion: 1, version: feed.version, downloadUrl };
}
