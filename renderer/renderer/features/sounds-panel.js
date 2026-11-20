import { dom } from '../core/dom.js';
import { ipc } from '../core/ipc.js';
import { uiState } from '../core/state.js';

export function openSoundsPanel() {
  if (uiState.isSoundsPanelOpen) {
    dom.soundsSectionsPanel.classList.remove('visible');
    uiState.isSoundsPanelOpen = false;
    return;
  }

  dom.soundsSectionsPanel.classList.add('visible');
  uiState.isSoundsPanelOpen = true;
  dom.soundsPanelContent.innerHTML = '<div class="sounds-loading">Загрузка конфигурации...</div>';

  const customBtn = document.createElement('button');
  customBtn.className = 'sounds-section-btn';
  customBtn.textContent = '📁 Свои';
  customBtn.title = 'Открыть папку с кастомными звуками';
  customBtn.addEventListener('click', () => ipc.openSoundsFolder());

  const dividerEl = document.createElement('div');
  dividerEl.className = 'sounds-divider';

  ipc.fetchSoundsConfig()
    .then((config) => {
      dom.soundsPanelContent.innerHTML = '';
      dom.soundsPanelContent.appendChild(customBtn);
      dom.soundsPanelContent.appendChild(dividerEl);

      if (!config || !config.sections) {
        dom.soundsPanelContent.innerHTML = '<div class="sounds-error">Разделы не найдены</div>';
        return;
      }

      for (const sectionName of Object.keys(config.sections)) {
        const btn = document.createElement('button');
        btn.className = 'sounds-section-btn';
        btn.textContent = sectionName;
        btn.addEventListener('click', () => downloadSectionSounds(sectionName));
        dom.soundsPanelContent.appendChild(btn);
      }
    })
    .catch((err) => {
      dom.soundsPanelContent.innerHTML = '<div class="sounds-error">Ошибка: ' + err.message + '</div>';
    });
}

async function downloadSectionSounds(sectionName) {
  dom.soundsPanelContent.innerHTML = `<div class="sounds-loading">Загрузка раздела "${sectionName}"...</div>`;
  try {
    await ipc.downloadSoundsSection(sectionName);
    dom.soundsPanelContent.innerHTML = `<div class="sounds-success">✅ Раздел "${sectionName}" загружен</div>`;
  } catch (err) {
    dom.soundsPanelContent.innerHTML = `<div class="sounds-error">❌ Ошибка: ${err.message}</div>`;
  }
}