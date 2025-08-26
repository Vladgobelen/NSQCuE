document.addEventListener('DOMContentLoaded', () => {
  const gameStatus = document.getElementById('game-status');
  const launchBtn = document.getElementById('launch-btn');
  const addonsList = document.getElementById('addons-list');
  const logsBtn = document.getElementById('logs-btn');
  const voiceBtn = document.getElementById('voice-btn');
  const changePathBtn = document.getElementById('change-path-btn');
  loadAddons();
  checkGame();
  launchBtn.addEventListener('click', launchGame);
  logsBtn.addEventListener('click', openLogsFolder);
  voiceBtn.addEventListener('click', showVoiceChat);
  changePathBtn.addEventListener('click', changeGamePath);
  window.electronAPI.onProgress((name, progress) => {
    updateAddonProgress(name, progress);
  });
  window.electronAPI.onOperationFinished((name, success) => {
    if (success) {
      refreshAddonStatus(name);
    }
  });
  window.electronAPI.onAddonUpdateAvailable((name) => {
    if (name === 'NSQC') {
      refreshAddonStatus(name);
    }
  });
  window.electronAPI.onError((error) => {
    showError(error);
    document.querySelectorAll('.addon-card input[type="checkbox"]').forEach(checkbox => {
      checkbox.disabled = false;
    });
  });
  async function loadAddons() {
    try {
      const addons = await window.electronAPI.loadAddons();
      renderAddons(addons);
    } catch (error) {
      console.error('Error loading addons:', error);
      showError('Не удалось загрузить список аддонов');
    }
  }
  function renderAddons(addons) {
    addonsList.innerHTML = '';
    for (const [name, addon] of Object.entries(addons)) {
      const addonElement = createAddonElement(name, addon);
      addonsList.appendChild(addonElement);
    }
  }
  function createAddonElement(name, addon) {
    const card = document.createElement('div');
    card.className = 'addon-card';
    card.dataset.name = name;
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'addon-content-wrapper';
    const overlay = document.createElement('div');
    overlay.className = 'progress-overlay';
    overlay.classList.add('hidden');
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
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `checkbox-${name}`;
    checkbox.checked = addon.installed;
    checkbox.disabled = addon.being_processed || addon.updating;
    const label = document.createElement('label');
    label.htmlFor = `checkbox-${name}`;
    label.className = 'custom-checkbox';
    topRow.appendChild(nameEl);
    topRow.appendChild(updateLabel);
    topRow.appendChild(checkbox);
    topRow.appendChild(label);
    const description = document.createElement('div');
    description.className = 'addon-description';
    description.textContent = addon.description;
    card.checkbox = checkbox;
    card.updateLabel = updateLabel;
    card.appendChild(overlay);
    contentWrapper.appendChild(topRow);
    contentWrapper.appendChild(description);
    card.appendChild(contentWrapper);
    if (addon.installed) {
      checkbox.addEventListener('mouseenter', () => {
        card.classList.add('deleting-warning');
      });
      checkbox.addEventListener('mouseleave', () => {
        card.classList.remove('deleting-warning');
      });
    }
    checkbox.addEventListener('change', () => {
      const willInstall = checkbox.checked;
      const originalState = !willInstall;
      checkbox.disabled = true;
      card.classList.remove('deleting-warning');
      window.electronAPI.toggleAddon(name, willInstall)
        .then(success => {
          if (!success) {
            checkbox.checked = originalState;
          }
        })
        .catch(error => {
          console.error(`Error toggling addon ${name}:`, error);
          checkbox.checked = originalState;
          checkbox.disabled = false;
        });
    });
    return card;
  }
  function updateAddonProgress(name, progress) {
    const cards = document.querySelectorAll('.addon-card');
    for (const card of cards) {
      if (card.dataset.name === name && card.overlay) {
        const overlay = card.overlay;
        const progressPercent = Math.min(progress, 1.0) * 100 + '%';
        overlay.style.setProperty('--progress', progressPercent);
        if (progress > 0) {
          overlay.classList.remove('hidden');
          overlay.style.opacity = '1';
        }
        if (progress >= 1.0) {
          setTimeout(() => {
            overlay.classList.add('hidden');
          }, 300);
        }
        break;
      }
    }
  }
  function refreshAddonStatus(name) {
    window.electronAPI.loadAddons().then(addons => {
      const addon = addons[name];
      if (!addon) return;
      const cards = document.querySelectorAll('.addon-card');
      for (const card of cards) {
        if (card.dataset.name === name) {
          card.checkbox.disabled = false;
          card.checkbox.checked = addon.installed;
          const checkbox = card.checkbox;
          const newCheckbox = checkbox.cloneNode(true);
          checkbox.parentNode.replaceChild(newCheckbox, checkbox);
          card.checkbox = newCheckbox;
          if (addon.installed) {
            newCheckbox.addEventListener('mouseenter', () => {
              card.classList.add('deleting-warning');
            });
            newCheckbox.addEventListener('mouseleave', () => {
              card.classList.remove('deleting-warning');
            });
          }
          newCheckbox.addEventListener('change', () => {
            const willInstall = newCheckbox.checked;
            const originalState = !willInstall;
            newCheckbox.disabled = true;
            card.classList.remove('deleting-warning');
            window.electronAPI.toggleAddon(name, willInstall)
              .then(success => {
                if (!success) {
                  newCheckbox.checked = originalState;
                }
              })
              .catch(error => {
                console.error(`Error toggling addon ${name}:`, error);
                newCheckbox.checked = originalState;
                newCheckbox.disabled = false;
              });
          });
          card.updateLabel.style.display = addon.needs_update ? 'inline' : 'none';
          if (card.overlay) {
            card.overlay.classList.add('hidden');
            card.overlay.style.opacity = '0';
          }
          break;
        }
      }
    }).catch(error => {
      console.error('Error refreshing addon status:', error);
      const cards = document.querySelectorAll('.addon-card');
      for (const card of cards) {
        if (card.dataset.name === name && card.overlay) {
          card.checkbox.disabled = false;
          card.overlay.classList.add('hidden');
        }
      }
    });
  }
  function checkGame() {
    window.electronAPI.checkGame().then(exists => {
      gameStatus.textContent = exists ? 'Готова к запуску' : 'Игра не найдена';
      gameStatus.style.color = exists ? '#4CAF50' : '#F44336';
      launchBtn.disabled = !exists;
    }).catch(() => {
      gameStatus.textContent = 'Ошибка проверки игры';
      gameStatus.style.color = '#F44336';
      launchBtn.disabled = true;
    });
  }
  async function launchGame() {
    const success = await window.electronAPI.launchGame();
    if (!success) {
      showError('Не удалось запустить игру');
    }
  }
  function openLogsFolder() {
    window.electronAPI.openLogsFolder();
  }
  async function changeGamePath() {
    const success = await window.electronAPI.changeGamePath();
    if (success) {
      checkGame();
      loadAddons();
    }
  }
  function showVoiceChat() {
    try {
        const existingVoiceChat = document.getElementById('voice-chat-overlay');
        if (existingVoiceChat) {
            document.body.removeChild(existingVoiceChat);
            return;
        }

        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
        overlay.style.zIndex = '9998';
        overlay.style.display = 'flex';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';
        overlay.id = 'voice-chat-overlay';

        const container = document.createElement('div');
        container.style.width = '100%';
        container.style.height = '100%';
        container.style.maxWidth = '100%';
        container.style.maxHeight = '100%';
        container.style.zIndex = '9999';
        container.style.position = 'relative';

        const iframe = document.createElement('iframe');
        iframe.src = 'voice-chat.html';
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframe.id = 'voice-chat-iframe';

        const messageHandler = (event) => {
            if (event.data && event.data.type === 'CLOSE_VOICE_CHAT') {
                window.removeEventListener('message', messageHandler);
                if (overlay.parentNode) {
                    overlay.parentNode.removeChild(overlay);
                }
            }
        };

        window.addEventListener('message', messageHandler);

        overlay.appendChild(container);
        container.appendChild(iframe);

        document.body.appendChild(overlay);

    } catch (error) {
        console.error('Error opening voice chat:', error);
        showError('Не удалось открыть голосовой чат: ' + error.message);
    }
  }
  function showError(message) {
    alert(`Ошибка: ${message}`);
  }
});