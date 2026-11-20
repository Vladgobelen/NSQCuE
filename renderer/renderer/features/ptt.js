import { dom } from '../core/dom.js';
import { ipc } from '../core/ipc.js';
import { uiState } from '../core/state.js';
import { formatHotkey } from '../core/utils.js';

export function updateSettingsTooltip(codes) {
  if (dom.panelSettingsBtn) dom.panelSettingsBtn.title = 'PTT: ' + formatHotkey(codes);
}

export function openSettingsPanel() {
  uiState.isSettingsOpen = true;
  dom.pttSettingsPanel.classList.add('visible');
  dom.pttCaptureArea.classList.add('active');
  dom.pttCaptureArea.textContent = 'Наведите курсор на это поле и нажмите клавиши...';
  uiState.capturedHotkey.clear();
  uiState.isMouseInCaptureZone = false;
  ipc.startKeyCapture().catch(() => {});
}

export function bindPTTEvents() {
  if (dom.pttCancelBtn) {
    dom.pttCancelBtn.addEventListener('click', () => {
      uiState.isSettingsOpen = false;
      dom.pttSettingsPanel.classList.remove('visible');
      dom.pttCaptureArea.classList.remove('active');
      uiState.isMouseInCaptureZone = false;
      ipc.getPTTHotkey().then(updateSettingsTooltip);
      ipc.stopKeyCapture();
    });
  }

  if (dom.pttSaveBtn) {
    dom.pttSaveBtn.addEventListener('click', async () => {
      const codes = Array.from(uiState.capturedHotkey);
      if (codes.length > 0) {
        const res = await ipc.setPTTHotkey(codes);
        if (res && res.success) {
          dom.pttCaptureArea.textContent = '✅ Сохранено: ' + codes.join(' + ');
          updateSettingsTooltip(codes);
          setTimeout(() => {
            dom.pttSettingsPanel.classList.remove('visible');
            dom.pttCaptureArea.classList.remove('active');
            uiState.isSettingsOpen = false;
            uiState.isMouseInCaptureZone = false;
            ipc.stopKeyCapture();
          }, 1000);
        } else {
          dom.pttCaptureArea.textContent = '❌ Ошибка сохранения';
        }
      } else {
        dom.pttCaptureArea.textContent = '⚠️ Сначала нажмите клавиши!';
      }
    });
  }

  if (dom.pttCaptureArea) {
    dom.pttCaptureArea.addEventListener('mouseenter', () => {
      uiState.isMouseInCaptureZone = true;
      if (uiState.capturedHotkey.size === 0) {
        dom.pttCaptureArea.textContent = 'Запись... Нажмите клавиши';
      }
    });
    dom.pttCaptureArea.addEventListener('mouseleave', () => {
      uiState.isMouseInCaptureZone = false;
      if (uiState.capturedHotkey.size === 0) {
        dom.pttCaptureArea.textContent = 'Наведите курсор и нажмите клавиши...';
      }
    });
  }
}