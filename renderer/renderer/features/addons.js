import { dom } from '../core/dom.js';
import { ipc } from '../core/ipc.js';
import { uiState } from '../core/state.js';
import { updateLaunchButtonState } from './game.js';
import { updateAddonProgress } from './addon-progress.js';

function buildUpdateTooltip(addon) {
  const remote = addon.version || 0;
  const local = addon.local_version || 0;
  if (remote > 0 && local > 0) return `Доступно обновление: v${local} → v${remote}`;
  if (remote > 0) return `Доступно обновление (v${remote})`;
  return 'Доступно обновление';
}

export function showAddonsLoading() {
  dom.addonsList.innerHTML = `
    <div class="addons-loading">
      <div class="addons-loading-spinner"></div>
      <div class="addons-loading-text" id="addons-loading-text">Поиск списка аддонов...</div>
      <div class="addons-loading-source" id="addons-loading-source"></div>
    </div>`;
}

export function showAddonsError() {
  dom.addonsList.innerHTML = `
    <div class="addons-loading">
      <div class="addons-loading-text">⚠️ Не удалось загрузить список аддонов</div>
      <button class="addons-retry-btn" id="addons-retry-btn">Повторить</button>
    </div>`;
  document.getElementById('addons-retry-btn').addEventListener('click', loadAddons);
}

export async function loadAddons() {
  uiState.isLoadingAddons = true;
  showAddonsLoading();
  try {
    const addons = await ipc.loadAddons();
    renderAddons(addons);
  } catch {
    showAddonsError();
  } finally {
    uiState.isLoadingAddons = false;
  }
}

// Порядок — строго как в state.addons (а он пересобран в порядке addons.json
// в main/addonManager/loadAddons.js). for...in заменён на Object.keys.
export function renderAddons(addons) {
  dom.addonsList.innerHTML = '';
  const names = Object.keys(addons);
  for (const name of names) {
    dom.addonsList.appendChild(createAddonElement(name, addons[name]));
  }
}

function createAddonElement(name, addon) {
  const card = document.createElement('div');
  card.className = 'addon-card';
  card.dataset.name = name;

  const contentWrapper = document.createElement('div');
  contentWrapper.className = 'addon-content-wrapper';

  const overlay = document.createElement('div');
  overlay.className = 'progress-overlay hidden';
  card.overlay = overlay;

  const topRow = document.createElement('div');
  topRow.className = 'addon-top';

  const nameEl = document.createElement('span');
  nameEl.className = 'addon-name';
  nameEl.textContent = name;

  const updateLabel = document.createElement('span');
  updateLabel.className = 'update-label';
  updateLabel.style.display = addon.needs_update ? 'inline' : 'none';
  updateLabel.textContent = 'Доступно обновление';
  updateLabel.title = buildUpdateTooltip(addon);

  const attemptLabel = document.createElement('span');
  attemptLabel.className = 'attempt-label';
  attemptLabel.style.display = 'none';
  card.attemptLabel = attemptLabel;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = 'checkbox-' + name;
  checkbox.checked = addon.installed;
  checkbox.disabled = addon.being_processed || addon.updating;

  const label = document.createElement('label');
  label.htmlFor = 'checkbox-' + name;
  label.className = 'custom-checkbox';

  topRow.append(nameEl, updateLabel, attemptLabel, checkbox, label);

  const description = document.createElement('div');
  description.className = 'addon-description';
  description.textContent = addon.description;

  card.checkbox = checkbox;
  card.updateLabel = updateLabel;
  card.appendChild(overlay);
  contentWrapper.append(topRow, description);
  card.appendChild(contentWrapper);

  if (addon.installed) {
    card.onmouseenter = () => card.classList.add('deleting-warning');
    card.onmouseleave = () => card.classList.remove('deleting-warning');
  }

  checkbox.addEventListener('change', () => {
    const willInstall = checkbox.checked;
    const originalState = !willInstall;
    checkbox.disabled = true;
    card.classList.remove('deleting-warning');

    uiState.isAddonInstalling = true;
    updateLaunchButtonState();

    uiState.downloadAttempts[name] = 0;
    if (card.attemptLabel) {
      card.attemptLabel.style.display = 'none';
      card.attemptLabel.textContent = '';
    }

    ipc.toggleAddon(name, willInstall)
      .then((success) => { if (!success) checkbox.checked = originalState; })
      .catch(() => { checkbox.checked = originalState; checkbox.disabled = false; })
      .finally(() => {
        uiState.isAddonInstalling = false;
        updateLaunchButtonState();
      });
  });

  return card;
}

export function updateAddonAttempt(data) {
  if (!data || !data.addonName) return;
  const cards = document.querySelectorAll('.addon-card');
  for (const card of cards) {
    if (card.dataset.name !== data.addonName) continue;
    if (!card.attemptLabel) return;
    card.attemptLabel.style.display = 'inline';
    card.attemptLabel.textContent = `🔄 Попытка ${data.attempt} (ссылка ${data.linkIndex}/${data.linkTotal})`;
    card.attemptLabel.title = 'Ошибка: ' + (data.error || '');
    return;
  }
}

function applyVersionInfoToCard(card, info) {
  if (!card || !info) return;
  if (card.updateLabel) {
    card.updateLabel.style.display = info.needs_update ? 'inline' : 'none';
    card.updateLabel.title = buildUpdateTooltip({
      version: info.version,
      local_version: info.local_version,
    });
  }
  if (card.checkbox && typeof info.installed === 'boolean') {
    card.checkbox.checked = info.installed;
  }
}

export function applyAddonsUpdateStatus(data) {
  if (!data || !data.addons) return;
  const cards = document.querySelectorAll('.addon-card');
  for (const card of cards) {
    const info = data.addons[card.dataset.name];
    if (info) applyVersionInfoToCard(card, info);
  }
}

export function refreshAddonStatus(name) {
  ipc.loadAddons()
    .then((addons) => {
      const addon = addons[name];
      if (!addon) return;
      const cards = document.querySelectorAll('.addon-card');
      for (const card of cards) {
        if (card.dataset.name !== name) continue;
        card.checkbox.disabled = false;
        card.checkbox.checked = addon.installed;

        if (card.overlay) {
          card.overlay.classList.add('hidden');
          card.overlay.style.opacity = '0';
          card.overlay.style.setProperty('--progress', '0%');
        }
        if (card.attemptLabel) {
          card.attemptLabel.style.display = 'none';
          card.attemptLabel.textContent = '';
        }
        uiState.downloadAttempts[name] = 0;

        if (addon.installed) {
          card.onmouseenter = () => card.classList.add('deleting-warning');
          card.onmouseleave = () => card.classList.remove('deleting-warning');
        } else {
          card.onmouseenter = null;
          card.onmouseleave = null;
        }
        if (card.updateLabel) {
          card.updateLabel.style.display = addon.needs_update ? 'inline' : 'none';
          card.updateLabel.title = buildUpdateTooltip(addon);
        }
        return;
      }
    })
    .catch(() => {
      const cards = document.querySelectorAll('.addon-card');
      for (const card of cards) {
        if (card.dataset.name === name) card.checkbox.disabled = false;
      }
    });
}