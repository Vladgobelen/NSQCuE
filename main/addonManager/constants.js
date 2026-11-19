const CONFIG_URLS = [
  'https://gitlab.com/Vladgobelen/NSQCu/-/raw/main/addons.json',
  'http://100.126.188.12:38593/addons/addons.json',
  'https://raw.githubusercontent.com/Vladgobelen/NSQCu/refs/heads/main/addons.json',
  'https://gitlab.com/Vladgobelen/nsqcmap/-/raw/main/addons.json',
];

// ─────────────────────────────────────────────────────────────
//  Реестр автообновляемых аддонов (версия берётся с Git)
// ─────────────────────────────────────────────────────────────
const AUTO_UPDATE_ADDONS = {
  NSQC4: {
    versionUrl: 'https://raw.githubusercontent.com/Vladgobelen/NSQC4/main/VERSION.lua',
    localVersionPath: 'Interface/AddOns/NSQC4/VERSION.lua',
    parser: 'lua-major-minor',
    compare: 'equal',
    checkInterval: 30 * 1000, // 30 сек
  },
  RAY: {
    versionUrl: 'https://raw.githubusercontent.com/Highest-V/RAY/main/RAY_Version.lua',
    localVersionPath: 'Interface/AddOns/RAY/RAY_Version.lua',
    parser: 'ray-string',
    compare: 'equal',
    checkInterval: 30 * 1000, // 30 сек
  },
};

const BACKGROUND_CHECK_INTERVAL = 30 * 1000;   // базовый тик чекера
const ALL_ADDONS_CHECK_EVERY_N_TICKS = 20;     // 20 * 30сек = 10 мин — все аддоны
const POST_INSTALL_DELAY = 3000;
const NET_TIMEOUT_CONFIG = 10000;
const NET_TIMEOUT_ADDON = 30000;
const NET_TIMEOUT_VERSION = 15000;

const DOWNLOAD_RETRY_DELAY = 10000;   // 10 секунд между попытками скачивания

module.exports = {
  CONFIG_URLS,
  AUTO_UPDATE_ADDONS,
  BACKGROUND_CHECK_INTERVAL,
  ALL_ADDONS_CHECK_EVERY_N_TICKS,
  POST_INSTALL_DELAY,
  NET_TIMEOUT_CONFIG,
  NET_TIMEOUT_ADDON,
  NET_TIMEOUT_VERSION,
  DOWNLOAD_RETRY_DELAY,
};