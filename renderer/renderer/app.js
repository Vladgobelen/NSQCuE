import { cacheDom } from './core/dom.js';
import { uiState } from './core/state.js';
import { ipc } from './core/ipc.js';
import { checkGame, bindGameEvents } from './features/game.js';
import { loadAddons } from './features/addons.js';
import { bindVoiceEvents } from './features/voice.js';
import { bindPanelEvents } from './features/panel.js';
import { bindPTTEvents, updateSettingsTooltip } from './features/ptt.js';
import { bindWebviewEvents, bindGlobalMessages, bindOverlayInput } from './features/webview-bridge.js';
import { bindMainProcessEvents } from './features/notifications.js';

document.addEventListener('DOMContentLoaded', async () => {
  cacheDom();

  bindGameEvents();
  bindVoiceEvents();
  bindPanelEvents();
  bindPTTEvents();
  bindWebviewEvents();
  bindGlobalMessages();
  bindOverlayInput();
  bindMainProcessEvents();

  // Первичная загрузка
  loadAddons();
  checkGame();

  try {
    const saved = await ipc.getPTTHotkey();
    updateSettingsTooltip(saved);
  } catch {
    updateSettingsTooltip(null);
  }
});