const OVERLAY_URL = 'https://100.126.188.12';

function isExternalUrl(url) {
  try {
    if (url.startsWith('file://')) return false;
    const urlObj = new URL(url);
    return urlObj.origin !== OVERLAY_URL;
  } catch {
    return false;
  }
}

module.exports = { OVERLAY_URL, isExternalUrl };