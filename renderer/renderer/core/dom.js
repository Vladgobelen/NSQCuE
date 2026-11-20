// Кэш DOM-узлов. Инициализируется один раз в app.js.
export const dom = {};

export function cacheDom() {
  dom.gameStatus = document.getElementById('game-status');
  dom.launchBtn = document.getElementById('launch-btn');
  dom.addonsList = document.getElementById('addons-list');
  dom.logsBtn = document.getElementById('logs-btn');
  dom.voiceBtn = document.getElementById('voice-btn');
  dom.changePathBtn = document.getElementById('change-path-btn');
  dom.webviewContainer = document.getElementById('webview-container');
  dom.nsWebview = document.getElementById('ns-webview');
  dom.backPanel = document.getElementById('back-panel');
  dom.backBtn = document.getElementById('back-btn');
  dom.panelMicBtn = document.getElementById('panel-mic-btn');
  dom.panelRefreshBtn = document.getElementById('panel-refresh-btn');
  dom.panelSettingsBtn = document.getElementById('panel-settings-btn');
  dom.panelSoundsBtn = document.getElementById('panel-sounds-btn');
  dom.panelAccountsBtn = document.getElementById('panel-accounts-btn');
  dom.pttSettingsPanel = document.getElementById('ptt-settings-panel');
  dom.pttCaptureArea = document.getElementById('ptt-capture-area');
  dom.pttSaveBtn = document.getElementById('ptt-save-btn');
  dom.pttCancelBtn = document.getElementById('ptt-cancel-btn');
  dom.soundsSectionsPanel = document.getElementById('sounds-sections-panel');
  dom.soundsPanelContent = document.getElementById('sounds-panel-content');
  dom.soundsCloseBtn = document.getElementById('sounds-close-btn');
  dom.topBar = document.getElementById('top-bar');
  dom.gamePanel = document.getElementById('game-panel');
  dom.divider = document.getElementById('divider');
  dom.addonsHeader = document.getElementById('addons-header');
}