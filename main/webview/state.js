let webviewWebContents = null;

function setWebviewWebContents(wc) {
  webviewWebContents = wc;
}

function getWebviewWebContents() {
  return webviewWebContents;
}

module.exports = { setWebviewWebContents, getWebviewWebContents };