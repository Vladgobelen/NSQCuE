import { dom } from '../core/dom.js';
import { ipc } from '../core/ipc.js';
import { uiState } from '../core/state.js';
import { showError } from '../core/utils.js';
import { openSoundsPanel } from './sounds-panel.js';
import { openSettingsPanel } from './ptt.js';
import { showAccountsModal } from './accounts.js';

export function bindPanelEvents() {
  // Показ/скрытие back-panel по hover
  dom.backPanel.addEventListener('mouseenter', () => {
    clearTimeout(uiState.hidePanelTimeout);
    dom.backPanel.classList.add('visible');
  });
  dom.backPanel.addEventListener('mouseleave', () => {
    if (uiState.isSettingsOpen || uiState.isSoundsPanelOpen) return;
    uiState.hidePanelTimeout = setTimeout(() => {
      dom.backPanel.classList.remove('visible');
    }, 500);
  });

  if (dom.panelMicBtn) {
    dom.panelMicBtn.addEventListener('click', () => {
      uiState.isPanelMicActive = !uiState.isPanelMicActive;
      dom.panelMicBtn.classList.toggle('active', uiState.isPanelMicActive);
      dom.panelMicBtn.title = uiState.isPanelMicActive ? 'Микрофон активен (выкл)' : 'Активировать микрофон';
      ipc.sendToWebClient('toggle-mic', { active: uiState.isPanelMicActive });
    });
  }

  if (dom.panelRefreshBtn) {
    dom.panelRefreshBtn.addEventListener('click', async () => {
      dom.panelRefreshBtn.style.pointerEvents = 'none';
      dom.panelRefreshBtn.style.opacity = '0.5';
      try {
        await ipc.clearWebviewCache();
        if (dom.nsWebview) dom.nsWebview.reload();
      } catch {
        showError('Ошибка обновления веб-клиента');
      } finally {
        setTimeout(() => {
          dom.panelRefreshBtn.style.pointerEvents = 'auto';
          dom.panelRefreshBtn.style.opacity = '1';
        }, 500);
      }
    });
  }

  if (dom.panelSettingsBtn) {
    dom.panelSettingsBtn.addEventListener('click', openSettingsPanel);
  }
  if (dom.panelSoundsBtn) {
    dom.panelSoundsBtn.addEventListener('click', openSoundsPanel);
  }
  if (dom.panelAccountsBtn) {
    dom.panelAccountsBtn.addEventListener('click', showAccountsModal);
  }
  if (dom.soundsCloseBtn) {
    dom.soundsCloseBtn.addEventListener('click', () => {
      dom.soundsSectionsPanel.classList.remove('visible');
      uiState.isSoundsPanelOpen = false;
    });
  }
}