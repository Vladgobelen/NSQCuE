const path = require('path');

function decodeFileName(rawName) {
  if (!rawName) return rawName;
  try {
    return decodeURIComponent(rawName);
  } catch {
    return rawName;
  }
}

function candidateFileNames(link) {
  const base = path.basename(link || '');
  if (!base) return [];

  const decoded = decodeFileName(base);
  const set = new Set([base, decoded]);

  const decodedTwice = decodeFileName(decoded);
  if (decodedTwice && decodedTwice !== decoded) set.add(decodedTwice);

  return Array.from(set).map((s) => s.toLowerCase());
}

function getLinks(addon) {
  if (Array.isArray(addon.links) && addon.links.length > 0) return addon.links;
  if (typeof addon.link === 'string' && addon.link) return [addon.link];
  return [];
}

module.exports = {
  decodeFileName,
  candidateFileNames,
  getLinks,
};