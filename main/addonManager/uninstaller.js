const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger');
const state = require('./state');
const { emitProgress } = require('./events');
const { candidateFileNames, getLinks } = require('./paths');

async function uninstallAddon(addon) {
  console.log('--------------------------------------------------');
  console.log(`[UNINSTALL] START ${addon.name}`);
  console.log('--------------------------------------------------');

  const gamePath = state.getGamePath();
  const targetDir = path.join(gamePath, addon.target_path);
  console.log('[UNINSTALL] targetDir =', targetDir);

  if (!(await fs.pathExists(targetDir))) {
    console.warn('[UNINSTALL] targetDir не существует — пропуск');
    emitProgress(addon.name, 1.0);
    return;
  }

  const items = await fs.readdir(targetDir, { withFileTypes: true });
  console.log('[UNINSTALL] items в targetDir =', items.map((i) => i.name));

  const lowerName = addon.name.toLowerCase();
  const candidates = new Set([
    lowerName,
    `${lowerName}.mpq`,
    `${lowerName}.zip`,
  ]);

  for (const link of getLinks(addon)) {
    for (const cand of candidateFileNames(link)) {
      candidates.add(cand);
      candidates.add(`${cand}.mpq`);
      candidates.add(`${cand}.zip`);
    }
  }
  console.log('[UNINSTALL] candidates =', Array.from(candidates));

  const toRemove = items.filter((i) => {
    const n = i.name.toLowerCase();
    if (candidates.has(n)) return true;
    if (n.startsWith(`${lowerName}-`) || n.startsWith(`${lowerName}_`))
      return true;
    const encodedName = encodeURIComponent(addon.name).toLowerCase();
    if (n.startsWith(`${encodedName}-`) || n.startsWith(`${encodedName}_`))
      return true;
    return false;
  });

  console.log(
    `[UNINSTALL] к удалению ${toRemove.length} элементов:`,
    toRemove.map((i) => i.name)
  );
  logger.info(
    `[UNINSTALL] ${addon.name}: к удалению ${toRemove.length} элементов`
  );

  for (let i = 0; i < toRemove.length; i++) {
    const progress = 0.1 + 0.8 * ((i + 1) / toRemove.length);
    emitProgress(addon.name, progress);
    const p = path.join(targetDir, toRemove[i].name);
    console.log(`[UNINSTALL] remove ${p}`);
    await fs.remove(p);
  }

  emitProgress(addon.name, 1.0);
  console.log(`[UNINSTALL] END ${addon.name} OK`);
}

module.exports = { uninstallAddon };