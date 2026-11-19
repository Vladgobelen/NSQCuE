const path = require('path');
const { AUTO_UPDATE_ADDONS } = require('./constants');
const { getLocalVersion, getRemoteVersion } = require('./versions');

function buildAddonFromConfig(name, cfg) {
  const description = cfg.description || '';
  const targetPath = cfg.target_path || '';

  let links = [];
  if (Array.isArray(cfg.links) && cfg.links.length > 0) {
    links = cfg.links.filter((u) => typeof u === 'string' && u.trim());
  } else if (typeof cfg.link === 'string' && cfg.link.trim()) {
    links = [cfg.link];
  }

  const firstLink = links[0] || '';
  const isZip =
    cfg.is_zip !== undefined
      ? cfg.is_zip
      : !firstLink.toLowerCase().endsWith('.mpq');

  const wrapInFolder =
    cfg.wrap_in_folder !== undefined
      ? !!cfg.wrap_in_folder
      : isZip && /(^|\/)AddOns\/?$/i.test(targetPath.replace(/\\/g, '/'));

  const remoteVersion = getRemoteVersion(cfg);
  const localVersion = getLocalVersion(name);

  return {
    name,
    description,
    installed: false,
    needs_update: false,
    being_processed: false,
    updating: false,
    links,
    link: firstLink,
    target_path: targetPath.replace(/\//g, path.sep),
    is_zip: isZip,
    wrap_in_folder: wrapInFolder,
    version: remoteVersion,
    local_version: localVersion,
  };
}

function computeNeedsUpdate(name, cfg) {
  // Автообновляемые аддоны не участвуют в общем сравнении версий
  if (AUTO_UPDATE_ADDONS[name]) return false;

  const local = getLocalVersion(name);
  const remote = getRemoteVersion(cfg);

  if (remote === 0) return false;
  if (local === 0) return false;

  return remote > local;
}

module.exports = {
  buildAddonFromConfig,
  computeNeedsUpdate,
};