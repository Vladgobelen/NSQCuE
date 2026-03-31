document.addEventListener('DOMContentLoaded', () => {
  const gameStatus = document.getElementById('game-status');
  const launchBtn = document.getElementById('launch-btn');
  const addonsList = document.getElementById('addons-list');
  const logsBtn = document.getElementById('logs-btn');
  const voiceBtn = document.getElementById('voice-btn');
  const changePathBtn = document.getElementById('change-path-btn');
  
  // WebView и панель
  const nsWebview = document.getElementById('ns-webview');
  const backPanel = document.getElementById('back-panel');
  const backBtn = document.getElementById('back-btn');
  
  // Элементы для скрытия
  const topBar = document.getElementById('top-bar');
  const gamePanel = document.getElementById('game-panel');
  const divider = document.getElementById('divider');
  const addonsHeader = document.getElementById('addons-header');
  
  let isWebViewVisible = false;
  let hidePanelTimeout = null;

  // === Инициализация ===
  loadAddons();
  checkGame();

  // === Обработчики кнопок ===
  launchBtn.addEventListener('click', launchGame);
  logsBtn.addEventListener('click', openLogsFolder);
  changePathBtn.addEventListener('click', changeGamePath);
  
  // === Кнопка микрофона → переключение на веб-клиент ===
  voiceBtn.addEventListener('click', () => {
    isWebViewVisible = true;
    toggleView();
  });
  
  // === Кнопка "Назад" → возврат к менеджеру аддонов ===
  backBtn.addEventListener('click', () => {
    isWebViewVisible = false;
    toggleView();
  });
  
  // === Логика скрытия/показа панели ===
  if (backPanel) {
    backPanel.addEventListener('mouseenter', () => {
      clearTimeout(hidePanelTimeout);
      backPanel.classList.add('visible');
    });
    
    backPanel.addEventListener('mouseleave', () => {
      hidePanelTimeout = setTimeout(() => {
        backPanel.classList.remove('visible');
      }, 500);
    });
  }

  // === Подписка на события Electron API ===
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

  // === Слушатели событий от веб-клиента ===
  if (window.electronAPI?.onWebClientEvent) {
    window.electronAPI.onWebClientEvent('mic-state', (state) => {
      if (voiceBtn) {
        voiceBtn.classList.toggle('speaking', state?.speaking);
        voiceBtn.classList.toggle('muted', state?.muted);
        voiceBtn.title = state?.muted ? 'Микрофон выключен' : 
                         state?.speaking ? 'Говорите...' : 'Микрофон готов';
      }
      if (window.electronAPI?.sendMicState) {
        window.electronAPI.sendMicState(state);
      }
    });
    
    window.electronAPI.onWebClientEvent('request-ptt-register', (config) => {
      if (window.electronAPI?.registerPTTHotkey && config?.hotkey) {
        window.electronAPI.registerPTTHotkey(config.hotkey)
          .then(result => {
            window.electronAPI.sendToWebClient('ptt-register-result', result);
          });
      }
    });
  }

  // === PTT: при активации хоткея отправляем сигнал во фрейм ===
  if (window.electronAPI?.onPTTActivated) {
    window.electronAPI.onPTTActivated(() => {
      console.log('PTT activated, signal sent to web client');
    });
  }

  // === События webview ===
  if (nsWebview) {
    nsWebview.addEventListener('dom-ready', () => {
      console.log('Web client frame ready');
      if (window.electronAPI?.sendToWebClient) {
        window.electronAPI.sendToWebClient('electron-config', {
          theme: 'dark',
          language: 'ru'
        });
      }
    });
    
    nsWebview.addEventListener('did-fail-load', (event) => {
      console.error('Web client failed to load:', event);
    });
  }

  // === Функция переключения вида ===
  function toggleView() {
    if (isWebViewVisible) {
      // Показываем веб-клиент на ВЕСЬ экран
      nsWebview.style.display = 'block';
      nsWebview.style.position = 'absolute';
      nsWebview.style.top = '0';
      nsWebview.style.left = '0';
      nsWebview.style.width = '100%';
      nsWebview.style.height = '100%';
      nsWebview.style.zIndex = '100';
      
      // Скрываем все элементы менеджера
      if (topBar) topBar.style.display = 'none';
      if (gamePanel) gamePanel.style.display = 'none';
      if (divider) divider.style.display = 'none';
      if (addonsHeader) addonsHeader.style.display = 'none';
      if (addonsList) addonsList.style.display = 'none';
      
      // Показываем панель "Назад"
      if (backPanel) backPanel.style.display = 'block';
      
      // Скрываем кнопку микрофона
      if (voiceBtn) voiceBtn.style.display = 'none';
      
      // Отправляем инициализацию
      if (window.electronAPI?.sendToWebClient) {
        window.electronAPI.sendToWebClient('electron-ready', {
          version: '1.0.0',
          platform: process?.platform || 'unknown'
        });
      }
    } else {
      // Возвращаем менеджер аддонов
      nsWebview.style.display = 'none';
      nsWebview.style.position = '';
      nsWebview.style.top = '';
      nsWebview.style.left = '';
      nsWebview.style.width = '';
      nsWebview.style.height = '';
      nsWebview.style.zIndex = '';
      
      // Показываем все элементы менеджера
      if (topBar) topBar.style.display = 'flex';
      if (gamePanel) gamePanel.style.display = 'flex';
      if (divider) divider.style.display = 'block';
      if (addonsHeader) addonsHeader.style.display = 'flex';
      if (addonsList) addonsList.style.display = 'block';
      
      // Скрываем панель "Назад"
      if (backPanel) backPanel.style.display = 'none';
      backPanel?.classList.remove('visible');
      
      // Показываем кнопку микрофона
      if (voiceBtn) voiceBtn.style.display = 'block';
    }
  }

  // === Функции ===
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

  function showError(message) {
    alert(`Ошибка: ${message}`);
  }
});