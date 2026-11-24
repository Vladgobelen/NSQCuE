import { dom } from '../core/dom.js';
import { ipc } from '../core/ipc.js';
import { uiState } from '../core/state.js';
import { updateLaunchButtonState } from './game.js';

// Сколько ждём рендера списка, если клик по уведомлению пришёл раньше.
const PENDING_FOCUS_TTL = 20000;
const FOCUS_FLASH_DELAY = 1800;

// Обновление идёт: name → { from, to }.
const updateTransitions = new Map();
// Обновление завершено, ждём наведения мыши: name → { from, to, version }.
const doneTransitions = new Map();

let pendingFocus = null;

function versionText(value) {
  if (value === null || value === undefined) return '?';
  if (typeof value === 'number') return value > 0 ? String(value) : '?';
  if (typeof value === 'object') {
    if (typeof value.major === 'number' && typeof value.minor === 'number') {
      return `${value.major}.${value.minor}`;
    }
    return '?';
  }
  const text = String(value).trim();
  return text || '?';
}

// Текущая версия для обычного состояния: установленная, иначе доступная.
function currentVersionText(addon) {
  if (addon && addon.installed) {
    const local = versionText(addon.local_version);
    if (local !== '?') return local;
  }
  return versionText(addon && addon.version);
}

function findCard(name) {
  const cards = document.querySelectorAll('.addon-card');
  for (const card of cards) {
    if (card.dataset.name === name) return card;
  }
  return null;
}

function buildUpdateTooltip(addon) {
  const remote = versionText(addon.version);
  const local = versionText(addon.local_version);
  if (remote !== '?' && local !== '?') return `Доступно обновление: ${local} >> ${remote}`;
  if (remote !== '?') return `Доступно обновление (версия ${remote})`;
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

// Порядок — строго как в state.addons (он пересобран в порядке addons.json).
export function renderAddons(addons) {
  dom.addonsList.innerHTML = '';
  for (const name of Object.keys(addons)) {
    dom.addonsList.appendChild(createAddonElement(name, addons[name]));
  }
  if (pendingFocus && Date.now() - pendingFocus.at < PENDING_FOCUS_TTL) {
    const name = pendingFocus.name;
    pendingFocus = null;
    setTimeout(() => focusAddon(name), 60);
  } else {
    pendingFocus = null;
  }
}

// Обычное состояние: всегда показываем текущую версию, подсветку снимаем.
function showCurrentVersion(card, version) {
  card.updateDone = false;
  card.classList.remove('updated');
  const label = card.versionLabel;
  if (!label) return;
  label.classList.remove('updating', 'done');
  const text = versionText(version);
  card.currentVersion = text;
  label.textContent = text;
  label.title = text !== '?' ? `Версия: ${text}` : '';
  label.style.display = 'inline';
}

// Переход "было >> стало". mode: 'updating' | 'done'.
function showVersionTransition(card, from, to, mode) {
  const label = card.versionLabel;
  if (!label) return;
  label.classList.toggle('updating', mode === 'updating');
  label.classList.toggle('done', mode === 'done');
  label.textContent = `${from} >> ${to}`;
  label.title =
    mode === 'updating'
      ? `Обновление: ${from} >> ${to}`
      : `Обновлено: ${from} >> ${to}`;
  label.style.display = 'inline';
}

// Наведение мыши: снимает послeобновляющую подсветку и показывает警告 удаления.
function bindHoverWarning(card) {
  card.onmouseenter = () => {
    // Во время обновления ничего не трогаем.
    if (card.isUpdating) return;
    // Наведение — единственный способ снять зелёную подсветку и переход версий.
    if (card.updateDone) {
      doneTransitions.delete(card.dataset.name);
      showCurrentVersion(card, card.currentVersion);
    }
    if (card.checkbox && card.checkbox.checked) {
      card.classList.add('deleting-warning');
    }
  };
  card.onmouseleave = () => card.classList.remove('deleting-warning');
}

// Подсветка обновляемого аддона + label "было >> стало".
function setCardUpdating(card, updating, from, to) {
  const name = card.dataset.name;
  card.isUpdating = updating;
  card.classList.toggle('updating', updating);

  if (updating) {
    card.updateDone = false;
    card.classList.remove('updated', 'deleting-warning');
    updateTransitions.set(name, { from, to });
    doneTransitions.delete(name);
    if (card.checkbox) card.checkbox.disabled = true;
    if (card.updateLabel) card.updateLabel.style.display = 'none';
    showVersionTransition(card, from, to, 'updating');
  } else {
    // Обновление завершено: зелёная подсветка держится до наведения мыши.
    card.updateDone = true;
    card.classList.add('updated');
    updateTransitions.delete(name);
    const newVersion = versionText(to);
    doneTransitions.set(name, { from, to, version: newVersion });
    card.currentVersion = newVersion;
    if (card.checkbox) card.checkbox.disabled = false;
    showVersionTransition(card, from, to, 'done');
  }
}

function createAddonElement(name, addon) {
  const card = document.createElement('div');
  card.className = 'addon-card';
  card.dataset.name = name;
  card.isUpdating = false;
  card.updateDone = false;
  card.currentVersion = currentVersionText(addon);
  card.flashTimer = null;

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

  const versionLabel = document.createElement('span');
  versionLabel.className = 'version-transition-label';
  card.versionLabel = versionLabel;

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

  topRow.append(nameEl, versionLabel, updateLabel, attemptLabel, checkbox, label);

  const description = document.createElement('div');
  description.className = 'addon-description';
  description.textContent = addon.description;

  card.checkbox = checkbox;
  card.updateLabel = updateLabel;
  card.appendChild(overlay);
  contentWrapper.append(topRow, description);
  card.appendChild(contentWrapper);

  bindHoverWarning(card);

  checkbox.addEventListener('change', () => {
    if (card.isUpdating) {
      checkbox.checked = !checkbox.checked;
      return;
    }
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
      .then((success) => {
        if (!success) checkbox.checked = originalState;
      })
      .catch(() => {
        checkbox.checked = originalState;
        checkbox.disabled = false;
      })
      .finally(() => {
        uiState.isAddonInstalling = false;
        updateLaunchButtonState();
      });
  });

  // Восстановление состояния после перерисовки списка.
  const active = updateTransitions.get(name);
  const done = doneTransitions.get(name);
  if (active) {
    setCardUpdating(card, true, active.from, active.to);
  } else if (done) {
    card.updateDone = true;
    card.classList.add('updated');
    card.currentVersion = done.version;
    showVersionTransition(card, done.from, done.to, 'done');
  } else {
    showCurrentVersion(card, card.currentVersion);
  }

  return card;
}

export function updateAddonAttempt(data) {
  if (!data || !data.addonName) return;
  const card = findCard(data.addonName);
  if (!card || !card.attemptLabel) return;
  card.attemptLabel.style.display = 'inline';
  card.attemptLabel.textContent = `🔄 Попытка ${data.attempt} (ссылка ${data.linkIndex}/${data.linkTotal})`;
  card.attemptLabel.title = 'Ошибка: ' + (data.error || '');
}

// Событие main → renderer: аддон обновляется / обновление закончено.
export function applyAddonUpdateState(data) {
  if (!data || !data.name) return;
  const from = data.from || '?';
  const to = data.to || '?';
  const card = findCard(data.name);
  if (card) {
    setCardUpdating(card, !!data.updating, from, to);
  } else if (data.updating) {
    updateTransitions.set(data.name, { from, to });
    doneTransitions.delete(data.name);
  } else {
    updateTransitions.delete(data.name);
    doneTransitions.set(data.name, { from, to, version: versionText(to) });
  }
}

// Краткая подсветка карточки после клика по уведомлению.
function flashCard(card) {
  if (card.flashTimer) clearTimeout(card.flashTimer);
  const prevShadow = card.style.boxShadow;
  const prevTransition = card.style.transition;
  card.style.transition = 'box-shadow 0.25s ease';
  card.style.boxShadow = '0 0 0 2px var(--accent), 0 0 18px rgba(42, 130, 218, 0.55)';
  card.flashTimer = setTimeout(() => {
    card.style.boxShadow = prevShadow;
    card.style.transition = prevTransition;
    card.flashTimer = null;
  }, FOCUS_FLASH_DELAY);
}

// Клик по уведомлению об обновлении: показать список и найти аддон.
export function focusAddon(name) {
  if (!name) return;
  const card = findCard(name);
  if (!card) {
    pendingFocus = { name, at: Date.now() };
    return;
  }
  pendingFocus = null;
  if (uiState.isWebViewVisible) {
    import('./voice.js')
      .then((m) => m.toggleView(false))
      .catch(() => {});
  }
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  flashCard(card);
}

function applyVersionInfoToCard(card, info) {
  if (!card || !info) return;
  if (card.checkbox && typeof info.installed === 'boolean') {
    card.checkbox.checked = info.installed;
  }
  // Во время обновления переход ведёт addon-update-state, снапшот не мешает.
  if (card.isUpdating) {
    if (card.updateLabel) card.updateLabel.style.display = 'none';
    return;
  }
  if (card.updateLabel) {
    card.updateLabel.style.display = info.needs_update ? 'inline' : 'none';
    card.updateLabel.title = buildUpdateTooltip({
      version: info.version,
      local_version: info.local_version,
    });
  }
  card.currentVersion = currentVersionText(info);
  // Зелёный переход держим до наведения мыши — версию не перетираем.
  if (!card.updateDone) {
    showCurrentVersion(card, card.currentVersion);
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
      const card = findCard(name);
      if (!card) return;
      const busy = !!addon.being_processed || !!addon.updating;
      card.isUpdating = busy;
      card.classList.toggle('updating', busy);
      card.checkbox.disabled = busy;
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
      bindHoverWarning(card);
      if (card.updateLabel) {
        card.updateLabel.style.display = addon.needs_update ? 'inline' : 'none';
        card.updateLabel.title = buildUpdateTooltip(addon);
      }
      card.currentVersion = currentVersionText(addon);
      // Обновление идёт или ждём наведения — переход/подсветку не трогаем.
      if (!busy && !card.updateDone) {
        showCurrentVersion(card, card.currentVersion);
      }
    })
    .catch(() => {
      const card = findCard(name);
      if (card) {
        card.isUpdating = false;
        card.classList.remove('updating');
        card.checkbox.disabled = false;
      }
    });
}