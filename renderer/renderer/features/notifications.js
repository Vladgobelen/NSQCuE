import { ipc } from '../core/ipc.js';
import { uiState } from '../core/state.js';
import {
  updateAddonAttempt,
  applyAddonsUpdateStatus,
  applyAddonUpdateState,
  refreshAddonStatus,
  focusAddon,
} from './addons.js';
import { updateAddonProgress } from './addon-progress.js';
import { updateLaunchButtonState } from './game.js';
import { dom } from '../core/dom.js';
import { showError } from '../core/utils.js';

export function bindMainProcessEvents() {
  ipc.onConfigSourceStatus((data) => {
    if (!uiState.isLoadingAddons) return;
    const textEl = document.getElementById('addons-loading-text');
    const sourceEl = document.getElementById('addons-loading-source');
    if (!sourceEl) return;
    const host = data.url.replace(/^https?:\/\//, '').split('/')[0];
    if (data.state === 'trying') {
      if (textEl) {
        textEl.textContent = `Поиск списка аддонов (источник ${data.index} из ${data.total})...`;
      }
      sourceEl.textContent = '⏳ ' + host;
    } else if (data.state === 'failed') {
      sourceEl.textContent = '❌ ' + host;
    } else if (data.state === 'loaded') {
      sourceEl.textContent = '✅ ' + host;
    }
  });

  ipc.onDownloadAttempt(updateAddonAttempt);
  ipc.onAddonsUpdateStatus(applyAddonsUpdateStatus);

  // Обновление аддона: подсветка + "прошлая >> текущая"
  ipc.onAddonUpdateState(applyAddonUpdateState);

  // Клик по всплывающему уведомлению об обновлении
  ipc.onFocusAddon(focusAddon);

  ipc.onBlockLaunchGame((blocked) => {
    uiState.isLaunchBlocked = blocked;
    updateLaunchButtonState();
  });

  ipc.onProgress(updateAddonProgress);

  // Refresh нужен при любом исходе: установленное состояние берём из main.
  ipc.onOperationFinished((name) => {
    setTimeout(() => refreshAddonStatus(name), 500);
  });

  ipc.onAddonUpdateAvailable((name) => {
    if (name === 'NSQC') refreshAddonStatus(name);
  });

  ipc.onError((error) => {
    showError(error);
    const checkboxes = document.querySelectorAll('.addon-card input[type="checkbox"]');
    for (const cb of checkboxes) cb.disabled = false;
    uiState.isAddonInstalling = false;
    updateLaunchButtonState();
  });

  ipc.onKeyCaptured((code) => {
    if (uiState.isMouseInCaptureZone) {
      uiState.capturedHotkey.add(code);
      dom.pttCaptureArea.textContent = Array.from(uiState.capturedHotkey).join(' + ');
    }
  });

  ipc.onPTTPressed(() => {
    if (!uiState.isPanelMicActive) {
      uiState.isPanelMicActive = true;
      if (dom.panelMicBtn) {
        dom.panelMicBtn.classList.add('active');
        dom.panelMicBtn.title = 'Микрофон активен (PTT)';
      }
      ipc.sendToWebClient('toggle-mic', { active: true });
    }
  });

  ipc.onPTTReleased(() => {
    if (uiState.isPanelMicActive) {
      uiState.isPanelMicActive = false;
      if (dom.panelMicBtn) {
        dom.panelMicBtn.classList.remove('active');
        dom.panelMicBtn.title = 'Активировать микрофон';
      }
      ipc.sendToWebClient('toggle-mic', { active: false });
    }
  });

  ipc.onSoundsDownloadProgress((progress) => {
    if (dom.soundsPanelContent && dom.soundsPanelContent.querySelector('.sounds-loading')) {
      dom.soundsPanelContent.innerHTML =
        `<div class="sounds-loading">Загрузка: ${progress.current}/${progress.total} (${progress.sound})</div>`;
    }
  });

  // События от веб-клиента
  ipc.onWebClientEvent('mic-state', (state) => {
    if (dom.voiceBtn) {
      dom.voiceBtn.classList.toggle('speaking', state && state.speaking);
      dom.voiceBtn.classList.toggle('muted', state && state.muted);
      dom.voiceBtn.title = state && state.muted
        ? 'Микрофон выключен'
        : state && state.speaking
          ? 'Говорите...'
          : 'Микрофон готов';
    }
    if (dom.panelMicBtn) {
      const active = (state && state.active) || (state && state.speaking) || false;
      if (uiState.isPanelMicActive !== active) {
        uiState.isPanelMicActive = active;
        dom.panelMicBtn.classList.toggle('active', active);
      }
    }
    window.electronAPI?.sendMicState?.(state);
  });

  ipc.onWebClientEvent('request-ptt-register', (config) => {
    if (window.electronAPI?.registerPTTHotkey && config?.hotkey) {
      window.electronAPI
        .registerPTTHotkey(config.hotkey)
        .then((result) => ipc.sendToWebClient('ptt-register-result', result))
        .catch(() => {});
    }
  });
}