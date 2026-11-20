import { dom } from '../core/dom.js';
import { ipc } from '../core/ipc.js';
import { uiState } from '../core/state.js';
import { showError } from '../core/utils.js';

export function updateLaunchButtonState() {
  if (!dom.launchBtn) return;
  dom.launchBtn.disabled = !uiState.isGameReady || uiState.isLaunchBlocked || uiState.isAddonInstalling;
  dom.launchBtn.textContent = uiState.isAddonInstalling ? 'Установка аддонов...' : 'Запустить игру';
}

export function checkGame() {
  ipc.checkGame()
    .then((exists) => {
      uiState.isGameReady = exists;
      dom.gameStatus.textContent = exists ? 'Готова к запуску' : 'Игра не найдена';
      dom.gameStatus.style.color = exists ? '#4CAF50' : '#F44336';
      updateLaunchButtonState();
    })
    .catch(() => {
      uiState.isGameReady = false;
      dom.gameStatus.textContent = 'Ошибка проверки игры';
      dom.gameStatus.style.color = '#F44336';
      updateLaunchButtonState();
    });
}

export async function launchGame() {
  if (uiState.isAddonInstalling) {
    showError('Дождитесь завершения установки аддонов');
    return;
  }
  const result = await ipc.launchGame();
  if (!result) showError('Не удалось запустить игру');
}

export function openLogsFolder() {
  ipc.openLogsFolder();
}

export async function changeGamePath() {
  const result = await ipc.changeGamePath();
  if (result) {
    checkGame();
    // Перезагрузить аддоны попросит app.js через событие или прямой вызов
    const { loadAddons } = await import('./addons.js');
    loadAddons();
  }
}

export function bindGameEvents() {
  dom.launchBtn.addEventListener('click', launchGame);
  dom.logsBtn.addEventListener('click', openLogsFolder);
  dom.changePathBtn.addEventListener('click', changeGamePath);
}