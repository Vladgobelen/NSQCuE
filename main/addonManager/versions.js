// ─────────────────────────────────────────────────────────────
//  Зашитые версии обычных аддонов (не автообновляемых)
// ─────────────────────────────────────────────────────────────
const LOCAL_ADDON_VERSIONS = {
  'WDM': 4,
  'Fonts': 1,
  'patch-ruRU-M.MPQ': 2,
  'patch-L.mpq': 1,
  'Patch-ruRU-b.mpq': 1,
  'patch-ruRU-y.mpq': 1,
  'patch-ruRU-N.mpq': 1,
  'patch-ruRU-O.mpq': 1,
  'patch-ruRU-P.mpq': 1,
  'patch-ruRU-Q.mpq': 1,
  'patch-ruRU-R.mpq': 1,
  'Questie-335': 1,
  'Bartender4': 1,
  'ArkInventory': 1,
  'Chatter': 1,
  'CrapAway': 1,
  'Disenchant': 1,
  'GearScore': 1,
  'Grid2': 1,
  'PlateBuffs': 1,
  'RangeDisplay': 1,
  'Skada': 1,
  'TomTom': 1,
  'DBM': 1,
  'Gatherer': 1,
  'Auctionator': 1,
  'BonusScanner': 1,
  'Ailo': 1,
  'DrDamage': 1,
  'MoveAnything': 1,
  'OmniCC': 1,
  'Quartz': 1,
  'SpeedyActions': 1,
  'Talented': 1,
  'TidyPlates': 1,
  'PallyPower': 1,
  'Atlas': 1,
  'NSQC': 1,
  'NSQC3': 1,
};

function getLocalVersion(name) {
  const v = LOCAL_ADDON_VERSIONS[name];
  return typeof v === 'number' ? v : 0;
}

function getRemoteVersion(cfg) {
  const v = cfg && cfg.version;
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    if (!isNaN(n)) return n;
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────
//  Парсеры версий автообновляемых аддонов
// ─────────────────────────────────────────────────────────────

// NSQC4: VERSION.lua с полями major / minor
function parseVersionLuaMajorMinor(text) {
  const majorMatch = String(text).match(/major\s*=\s*(\d+)/i);
  const minorMatch = String(text).match(/minor\s*=\s*(\d+)/i);
  if (!majorMatch || !minorMatch) {
    throw new Error('VERSION.lua: не найдены major/minor');
  }
  return {
    major: parseInt(majorMatch[1], 10),
    minor: parseInt(minorMatch[1], 10),
  };
}

// RAY: строка вида `local RAY_addonVersion  = "8.5"`
function parseRayVersion(text) {
  const match = String(text).match(/RAY_addonVersion\s*=\s*"([^"]+)"/);
  if (!match) {
    throw new Error('RAY_Version.lua: не найдена RAY_addonVersion');
  }
  return match[1].trim();
}

// ─────────────────────────────────────────────────────────────
//  Сравнение версий
// ─────────────────────────────────────────────────────────────

// NSQC4: равенство major/minor
function versionsEqualMajorMinor(a, b) {
  if (!a || !b) return false;
  return a.major === b.major && a.minor === b.minor;
}

// RAY: строгое равенство строк
function versionsEqualString(a, b) {
  if (a == null || b == null) return false;
  return String(a).trim() === String(b).trim();
}

function versionsEqual(compareType, a, b) {
  switch (compareType) {
    case 'lua-major-minor':
      return versionsEqualMajorMinor(a, b);
    case 'ray-string':
      return versionsEqualString(a, b);
    default:
      return false;
  }
}

// Универсальный парсер по типу
function parseVersion(parserType, text) {
  switch (parserType) {
    case 'lua-major-minor':
      return parseVersionLuaMajorMinor(text);
    case 'ray-string':
      return parseRayVersion(text);
    default:
      throw new Error(`Неизвестный парсер версии: ${parserType}`);
  }
}

module.exports = {
  LOCAL_ADDON_VERSIONS,
  getLocalVersion,
  getRemoteVersion,
  parseVersionLuaMajorMinor,
  parseRayVersion,
  parseVersion,
  versionsEqualMajorMinor,
  versionsEqualString,
  versionsEqual,
};