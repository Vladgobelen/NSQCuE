const fs = require('fs-extra');
const path = require('path');
const { AUTO_UPDATE_ADDONS } = require('./constants');
const { candidateFileNames } = require('./paths');

function checkInstalled(name, targetPath, gamePath, addonOrLink) {
  console.log('[CHECK_INSTALLED] START');
  console.log('[CHECK_INSTALLED]   name =', name);
  console.log('[CHECK_INSTALLED]   targetPath =', targetPath);
  console.log('[CHECK_INSTALLED]   gamePath =', gamePath);

  if (!gamePath) {
    console.warn('[CHECK_INSTALLED] gamePath пуст → false');
    return false;
  }

  const fullTarget = path.join(gamePath, targetPath);
  console.log('[CHECK_INSTALLED] fullTarget =', fullTarget);
  if (!fs.existsSync(fullTarget)) {
    console.warn('[CHECK_INSTALLED] fullTarget не существует → false');
    return false;
  }

  const lowerName = name.toLowerCase();

  try {
    const items = fs.readdirSync(fullTarget, { withFileTypes: true });
    const namesLower = items.map((it) => it.name.toLowerCase());
    console.log('[CHECK_INSTALLED] names в targetDir =', namesLower);

    if (namesLower.includes(lowerName)) {
      console.log('[CHECK_INSTALLED] найдено по имени → true');
      return true;
    }

    if (AUTO_UPDATE_ADDONS[name]) {
      const dir = path.join(fullTarget, name);
      if (fs.existsSync(dir)) {
        console.log('[CHECK_INSTALLED] auto-update папка найдена → true');
        return true;
      }
    }

    if (lowerName.endsWith('.mpq')) {
      if (namesLower.includes(`${lowerName}.mpq`)) {
        console.log('[CHECK_INSTALLED] mpq найден → true');
        return true;
      }

      const allCandidates = new Set();
      if (addonOrLink && Array.isArray(addonOrLink.links)) {
        for (const l of addonOrLink.links) {
          for (const c of candidateFileNames(l)) allCandidates.add(c);
        }
      } else if (typeof addonOrLink === 'string' && addonOrLink) {
        for (const c of candidateFileNames(addonOrLink)) allCandidates.add(c);
      }
      console.log('[CHECK_INSTALLED] mpq candidates =', Array.from(allCandidates));
      for (const cand of allCandidates) {
        if (namesLower.includes(cand)) {
          console.log('[CHECK_INSTALLED] mpq candidate найден:', cand, '→ true');
          return true;
        }
      }
    }

    console.log('[CHECK_INSTALLED] END → false');
    return false;
  } catch (e) {
    console.error('[CHECK_INSTALLED] исключение:', e);
    return false;
  }
}

module.exports = { checkInstalled };