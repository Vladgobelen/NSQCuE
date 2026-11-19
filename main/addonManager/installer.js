const fs = require('fs-extra');
const path = require('path');
const unzipper = require('unzipper');
const os = require('os');
const logger = require('./logger');
const state = require('./state');
const { emitProgress } = require('./events');
const { decodeFileName, getLinks } = require('./paths');
const { downloadWithFallback } = require('./downloader');
const { handleArchiveStructure } = require('./archive');

async function installAddon(addon) {
  console.log('--------------------------------------------------');
  console.log(`[INSTALL] START ${addon.name}`);
  console.log('--------------------------------------------------');

  emitProgress(addon.name, 0.15);

  const gamePath = state.getGamePath();
  const targetDir = path.join(gamePath, addon.target_path);
  console.log('[INSTALL] gamePath =', gamePath);
  console.log('[INSTALL] targetDir =', targetDir);
  await fs.ensureDir(targetDir);
  console.log('[INSTALL] ensureDir OK');

  const links = getLinks(addon);
  console.log('[INSTALL] links =', links);

  if (links.length === 0) {
    throw new Error(`У аддона ${addon.name} нет ни одной ссылки`);
  }

  const isMpq = links[0].toLowerCase().endsWith('.mpq');
  const stamp = Date.now();
  const tempDir = path.join(os.tmpdir(), `extract_${addon.name}_${stamp}`);
  const tempFile = path.join(
    os.tmpdir(),
    `download_${addon.name}_${stamp}${isMpq ? '.mpq' : '.zip'}`
  );

  console.log('[INSTALL] isMpq =', isMpq);
  console.log('[INSTALL] tempFile =', tempFile);
  console.log('[INSTALL] tempDir =', tempDir);

  try {
    console.log('[INSTALL] → downloadWithFallback()');
    const { usedUrl } = await downloadWithFallback(
      links,
      tempFile,
      (frac) => {
        const base = 0.15;
        const span = isMpq ? 0.6 : 0.5;
        const p = base + span * frac;
        emitProgress(addon.name, p);
      },
      addon.name
    );
    console.log('[INSTALL] ← downloadWithFallback() OK, usedUrl =', usedUrl);
    logger.info(`[INSTALL] ${addon.name}: скачано с ${usedUrl}`);

    if (isMpq) {
      console.log('[INSTALL] режим MPQ');
      let rawName;
      try {
        rawName = path.basename(new URL(usedUrl).pathname);
      } catch {
        rawName = path.basename(usedUrl);
      }
      const decodedName = decodeFileName(rawName);
      const mpqPath = path.join(targetDir, decodedName);
      console.log('[INSTALL] rawName =', rawName);
      console.log('[INSTALL] decodedName =', decodedName);
      console.log('[INSTALL] mpqPath =', mpqPath);

      const altPath = path.join(targetDir, rawName);
      if (altPath !== mpqPath && (await fs.pathExists(altPath))) {
        try {
          await fs.remove(altPath);
          console.log('[INSTALL] удалён altPath =', altPath);
        } catch {}
      }

      await fs.move(tempFile, mpqPath, { overwrite: true });
      console.log('[INSTALL] MPQ перемещён в', mpqPath);
      logger.info(`[INSTALL] ${addon.name}: MPQ перемещён в ${mpqPath}`);
    } else {
      console.log('[INSTALL] режим ZIP, ensureDir tempDir');
      await fs.ensureDir(tempDir);
      console.log('[INSTALL] → unzipper.Extract()');
      await new Promise((resolve, reject) => {
        fs.createReadStream(tempFile)
          .pipe(unzipper.Extract({ path: tempDir }))
          .on('close', resolve)
          .on('error', reject);
      });
      console.log('[INSTALL] ← unzipper.Extract() OK');

      console.log('[INSTALL] → handleArchiveStructure() wrap_in_folder =', addon.wrap_in_folder !== false);
      await handleArchiveStructure(
        tempDir,
        targetDir,
        addon.name,
        addon.wrap_in_folder !== false
      );
      console.log('[INSTALL] ← handleArchiveStructure() OK');
    }

    emitProgress(addon.name, 1.0);
    console.log(`[INSTALL] END ${addon.name} OK`);
    logger.info(`[INSTALL] ${addon.name}: завершено`);
  } catch (error) {
    console.error('[INSTALL] ОШИБКА:', error && error.stack ? error.stack : error);
    logger.error(
      `[INSTALL] ${addon.name}:`,
      error.message || error.code || String(error)
    );
    throw new Error(
      `Failed to install ${addon.name}: ${
        error.message || error.code || 'Unknown error'
      }`
    );
  } finally {
    console.log('[INSTALL] cleanup temp');
    await Promise.allSettled([
      fs.remove(tempDir).catch(() => {}),
      fs.remove(tempFile).catch(() => {}),
    ]);
    console.log('[INSTALL] cleanup done');
  }
}

module.exports = { installAddon };