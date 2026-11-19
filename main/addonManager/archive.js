const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger');

async function handleArchiveStructure(tempDir, targetDir, addonName, wrapInFolder) {
  console.log('[ARCHIVE] START');
  console.log('[ARCHIVE]   tempDir =', tempDir);
  console.log('[ARCHIVE]   targetDir =', targetDir);
  console.log('[ARCHIVE]   addonName =', addonName);
  console.log('[ARCHIVE]   wrapInFolder =', wrapInFolder);

  const topEntries = await fs.readdir(tempDir, { withFileTypes: true });
  console.log('[ARCHIVE] topEntries =', topEntries.map((e) => `${e.name}${e.isDirectory() ? '/' : ''}`));

  let sourceDir = tempDir;
  if (topEntries.length === 1 && topEntries[0].isDirectory()) {
    sourceDir = path.join(tempDir, topEntries[0].name);
    console.log('[ARCHIVE] одна папка сверху → sourceDir =', sourceDir);
  }

  const inner = await fs.readdir(sourceDir, { withFileTypes: true });
  console.log('[ARCHIVE] inner =', inner.map((e) => `${e.name}${e.isDirectory() ? '/' : ''}`));

  if (wrapInFolder) {
    const destDir = path.join(targetDir, addonName);
    console.log('[ARCHIVE] wrapInFolder=true, destDir =', destDir);

    const namedDir = inner.find(
      (e) =>
        e.isDirectory() && e.name.toLowerCase() === addonName.toLowerCase()
    );
    console.log('[ARCHIVE] namedDir =', namedDir ? namedDir.name : null);

    if (namedDir) {
      const src = path.join(sourceDir, namedDir.name);
      if (await fs.pathExists(destDir)) await fs.remove(destDir);
      await fs.move(src, destDir, { overwrite: true });
      console.log(`[ARCHIVE] папка-аддон перемещена в ${destDir}`);
      logger.info(`[ARCHIVE] ${addonName}: папка-аддон перемещена в ${destDir}`);
      return;
    }

    if (await fs.pathExists(destDir)) await fs.remove(destDir);
    await fs.ensureDir(destDir);

    for (const e of inner) {
      const src = path.join(sourceDir, e.name);
      const dst = path.join(destDir, e.name);
      console.log('[ARCHIVE] move', src, '→', dst);
      await fs.move(src, dst, { overwrite: true });
    }
    console.log(`[ARCHIVE] содержимое обёрнуто в ${destDir}`);
    logger.info(`[ARCHIVE] ${addonName}: содержимое обёрнуто в ${destDir}`);
    return;
  }

  for (const e of inner) {
    const src = path.join(sourceDir, e.name);
    const dst = path.join(targetDir, e.name);
    console.log('[ARCHIVE] copy', src, '→', dst);
    if (e.isDirectory()) await fs.copy(src, dst);
    else await fs.copyFile(src, dst);
  }
  console.log(`[ARCHIVE] распаковано плоско в ${targetDir}`);
  logger.info(`[ARCHIVE] ${addonName}: распаковано плоско в ${targetDir}`);
}

module.exports = { handleArchiveStructure };