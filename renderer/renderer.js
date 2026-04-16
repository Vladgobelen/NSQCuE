document.addEventListener('DOMContentLoaded', () => {
  const gameStatus = document.getElementById('game-status');
  const launchBtn = document.getElementById('launch-btn');
  const addonsList = document.getElementById('addons-list');
  const logsBtn = document.getElementById('logs-btn');
  const voiceBtn = document.getElementById('voice-btn');
  const changePathBtn = document.getElementById('change-path-btn');
  const webviewContainer = document.getElementById('webview-container');
  const nsWebview = document.getElementById('ns-webview');
  const backPanel = document.getElementById('back-panel');
  const backBtn = document.getElementById('back-btn');
  const panelMicBtn = document.getElementById('panel-mic-btn');
  const panelRefreshBtn = document.getElementById('panel-refresh-btn');
  const panelSettingsBtn = document.getElementById('panel-settings-btn');
  const panelSoundsBtn = document.getElementById('panel-sounds-btn');
  const panelTestBtn = document.getElementById('panel-test-btn');
  const pttSettingsPanel = document.getElementById('ptt-settings-panel');
  const pttCaptureArea = document.getElementById('ptt-capture-area');
  const pttSaveBtn = document.getElementById('ptt-save-btn');
  const pttCancelBtn = document.getElementById('ptt-cancel-btn');
  const soundsSectionsPanel = document.getElementById('sounds-sections-panel');
  const soundsPanelContent = document.getElementById('sounds-panel-content');
  const soundsCloseBtn = document.getElementById('sounds-close-btn');
  const topBar = document.getElementById('top-bar');
  const gamePanel = document.getElementById('game-panel');
  const divider = document.getElementById('divider');
  const addonsHeader = document.getElementById('addons-header');

  let isWebViewVisible = false;
  let hidePanelTimeout = null;
  let isPanelMicActive = false;
  let capturedHotkey = new Set();
  let isSettingsOpen = false;
  let isSoundsPanelOpen = false;
  let isMouseInCaptureZone = false;
  let isGameReady = false;
  let isLaunchBlocked = false;

  function updateLaunchButtonState() {
    if (launchBtn) {
      launchBtn.disabled = !isGameReady || isLaunchBlocked;
    }
  }

  function formatHotkey(codes) {
    if (!codes || !Array.isArray(codes) || codes.length === 0) {
      return 'Не задан';
    }
    const keyNames = {
      16: 'Shift', 17: 'Ctrl', 18: 'Alt', 32: 'Space', 27: 'Esc', 13: 'Enter',
      9: 'Tab', 8: 'Backspace', 46: 'Del', 37: '←', 38: '↑', 39: '→', 40: '↓',
      112: 'F1', 113: 'F2', 114: 'F3', 115: 'F4', 116: 'F5', 117: 'F6', 118: 'F7', 119: 'F8',
      120: 'F9', 121: 'F10', 122: 'F11', 123: 'F12',
      272: 'Mouse4', 273: 'Mouse5', 276: 'MouseLeft', 277: 'MouseRight', 278: 'MouseMiddle'
    };
    return codes.map(code => keyNames[code] || `K${code}`).join(' + ');
  }

  function updateSettingsTooltip(codes) {
    if (panelSettingsBtn) {
      panelSettingsBtn.title = `PTT: ${formatHotkey(codes)}`;
    }
  }

  function showError(message) {
    alert(`Ошибка: ${message}`);
  }

  async function loadAddons() {
    try {
      const addons = await window.electronAPI.loadAddons();
      renderAddons(addons);
    } catch {
      showError('Не удалось загрузить список аддонов');
    }
  }

  function renderAddons(addons) {
    addonsList.innerHTML = '';
    for (const [name, addon] of Object.entries(addons)) {
      addonsList.appendChild(createAddonElement(name, addon));
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
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `checkbox-${name}`;
    checkbox.checked = addon.installed;
    checkbox.disabled = addon.being_processed || addon.updating;
    const label = document.createElement('label');
    label.htmlFor = `checkbox-${name}`;
    label.className = 'custom-checkbox';
    topRow.append(nameEl, updateLabel, checkbox, label);
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
      window.electronAPI.toggleAddon(name, willInstall)
        .then(success => {
          if (!success) {
            checkbox.checked = originalState;
          }
        })
        .catch(() => {
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
        card.overlay.style.setProperty('--progress', Math.min(progress, 1.0) * 100 + '%');
        card.overlay.classList.toggle('hidden', progress <= 0);
        card.overlay.style.opacity = progress > 0 ? '1' : '0';
        if (progress >= 1.0) {
          setTimeout(() => {
            card.overlay.classList.add('hidden');
            card.overlay.style.opacity = '';
          }, 300);
        }
        break;
      }
    }
  }

  function refreshAddonStatus(name) {
    window.electronAPI.loadAddons()
      .then(addons => {
        const addon = addons[name];
        if (!addon) return;
        const cards = document.querySelectorAll('.addon-card');
        for (const card of cards) {
          if (card.dataset.name === name) {
            card.checkbox.disabled = false;
            card.checkbox.checked = addon.installed;
            if (card.overlay) {
              card.overlay.classList.add('hidden');
              card.overlay.style.opacity = '0';
              card.overlay.style.setProperty('--progress', '0%');
            }
            if (addon.installed) {
              card.onmouseenter = () => card.classList.add('deleting-warning');
              card.onmouseleave = () => card.classList.remove('deleting-warning');
            } else {
              card.onmouseenter = null;
              card.onmouseleave = null;
            }
            card.updateLabel.style.display = addon.needs_update ? 'inline' : 'none';
            break;
          }
        }
      })
      .catch(() => {
        const cards = document.querySelectorAll('.addon-card');
        for (const card of cards) {
          if (card.dataset.name === name) {
            card.checkbox.disabled = false;
          }
        }
      });
  }

  function checkGame() {
    window.electronAPI.checkGame()
      .then(exists => {
        isGameReady = exists;
        gameStatus.textContent = exists ? 'Готова к запуску' : 'Игра не найдена';
        gameStatus.style.color = exists ? '#4CAF50' : '#F44336';
        updateLaunchButtonState();
      })
      .catch(() => {
        isGameReady = false;
        gameStatus.textContent = 'Ошибка проверки игры';
        gameStatus.style.color = '#F44336';
        updateLaunchButtonState();
      });
  }

  async function launchGame() {
    const result = await window.electronAPI.launchGame();
    if (!result) {
      showError('Не удалось запустить игру');
    }
  }

  function openLogsFolder() {
    window.electronAPI.openLogsFolder();
  }

  async function changeGamePath() {
    const result = await window.electronAPI.changeGamePath();
    if (result) {
      checkGame();
      loadAddons();
    }
  }

  async function toggleView() {
    if (isWebViewVisible) {
      webviewContainer?.classList.add('active');
      topBar.style.display = 'none';
      gamePanel.style.display = 'none';
      divider.style.display = 'none';
      addonsHeader.style.display = 'none';
      addonsList.style.display = 'none';
      backPanel.style.display = 'flex';
      voiceBtn.style.display = 'none';
      try {
        const platform = await window.electronAPI.getPlatform();
        window.electronAPI.sendToWebClient('electron-ready', {
          version: '1.0.0',
          platform: platform || 'unknown',
          userAgent: navigator.userAgent
        });
      } catch {
        window.electronAPI.sendToWebClient('electron-ready', {
          version: '1.0.0',
          platform: 'unknown',
          userAgent: navigator.userAgent
        });
      }
    } else {
      webviewContainer?.classList.remove('active');
      topBar.style.display = 'flex';
      gamePanel.style.display = 'flex';
      divider.style.display = 'block';
      addonsHeader.style.display = 'flex';
      addonsList.style.display = 'block';
      backPanel.style.display = 'none';
      backPanel.classList.remove('visible');
      voiceBtn.style.display = 'block';
    }
  }

  async function openSoundsPanel() {
    if (isSoundsPanelOpen) {
      soundsSectionsPanel.classList.remove('visible');
      isSoundsPanelOpen = false;
      return;
    }
    soundsSectionsPanel.classList.add('visible');
    isSoundsPanelOpen = true;
    soundsPanelContent.innerHTML = '<div class="sounds-loading">Загрузка конфигурации...</div>';
    try {
      const customBtn = document.createElement('button');
      customBtn.className = 'sounds-section-btn';
      customBtn.textContent = '📁 Свои';
      customBtn.title = 'Открыть папку с кастомными звуками';
      customBtn.addEventListener('click', () => {
        window.electronAPI.openSoundsFolder();
      });
      soundsPanelContent.appendChild(customBtn);
      const divider = document.createElement('div');
      divider.className = 'sounds-divider';
      soundsPanelContent.appendChild(divider);
      const config = await window.electronAPI.fetchSoundsConfig();
      soundsPanelContent.innerHTML = '';
      soundsPanelContent.appendChild(customBtn);
      soundsPanelContent.appendChild(divider);
      if (!config?.sections) {
        soundsPanelContent.innerHTML = '<div class="sounds-error">Разделы не найдены</div>';
        return;
      }
      for (const sectionName of Object.keys(config.sections)) {
        const btn = document.createElement('button');
        btn.className = 'sounds-section-btn';
        btn.textContent = sectionName;
        btn.addEventListener('click', () => downloadSectionSounds(sectionName));
        soundsPanelContent.appendChild(btn);
      }
    } catch (err) {
      soundsPanelContent.innerHTML = `<div class="sounds-error">Ошибка: ${err.message}</div>`;
    }
  }

  async function downloadSectionSounds(sectionName) {
    soundsPanelContent.innerHTML = `<div class="sounds-loading">Загрузка раздела "${sectionName}"...</div>`;
    try {
      await window.electronAPI.downloadSoundsSection(sectionName);
      soundsPanelContent.innerHTML = `<div class="sounds-success">✅ Раздел "${sectionName}" загружен</div>`;
    } catch (err) {
      soundsPanelContent.innerHTML = `<div class="sounds-error">❌ Ошибка: ${err.message}</div>`;
    }
  }

  // Функция отправки сообщения в веб-чат
  function sendMessageToWebChat(text) {
    const webview = document.getElementById('ns-webview');
    if (!webview) {
      console.warn('[OVERLAY] WebView not found');
      return;
    }
    
    const escapedText = text.replace(/'/g, "\\'").replace(/"/g, '\\"');
    
    const code = `
      (function() {
        const selectors = [
          'input[type="text"]',
          'textarea',
          '[contenteditable="true"]',
          '.chat-input',
          '#chat-input',
          '.message-input'
        ];
        
        let input = null;
        for (const s of selectors) {
          input = document.querySelector(s);
          if (input) break;
        }
        
        if (input) {
          if (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA') {
            input.value = '${escapedText}';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            
            const sendBtn = document.querySelector('button[type="submit"], .send-button, #send-button');
            if (sendBtn) {
              sendBtn.click();
            } else {
              input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
            }
            return true;
          }
        }
        return false;
      })();
    `;
    
    webview.executeJavaScript(code).then(result => {
      if (result) {
        console.log('[OVERLAY] Message sent to web chat');
      } else {
        console.warn('[OVERLAY] Could not find chat input');
      }
    }).catch(err => {
      console.error('[OVERLAY] Error sending to web chat:', err);
    });
  }

  loadAddons();
  checkGame();

  (async () => {
    try {
      const saved = await window.electronAPI?.getPTTHotkey?.();
      updateSettingsTooltip(saved);
    } catch {
      updateSettingsTooltip(null);
    }
  })();

  if (window.electronAPI?.onBlockLaunchGame) {
    window.electronAPI.onBlockLaunchGame(blocked => {
      isLaunchBlocked = blocked;
      updateLaunchButtonState();
    });
  }

  launchBtn.addEventListener('click', () => {
    launchGame();
  });

  logsBtn.addEventListener('click', () => {
    openLogsFolder();
  });

  changePathBtn.addEventListener('click', () => {
    changeGamePath();
  });

  voiceBtn.addEventListener('click', async () => {
    isWebViewVisible = true;
    await toggleView();
  });

  backBtn.addEventListener('click', () => {
    isWebViewVisible = false;
    toggleView();
  });

  if (panelMicBtn) {
    panelMicBtn.addEventListener('click', () => {
      isPanelMicActive = !isPanelMicActive;
      panelMicBtn.classList.toggle('active', isPanelMicActive);
      panelMicBtn.title = isPanelMicActive ? 'Микрофон активен (выкл)' : 'Активировать микрофон';
      window.electronAPI?.sendToWebClient('toggle-mic', { active: isPanelMicActive });
    });
  }

  if (panelRefreshBtn) {
    panelRefreshBtn.addEventListener('click', async () => {
      panelRefreshBtn.style.pointerEvents = 'none';
      panelRefreshBtn.style.opacity = '0.5';
      try {
        await window.electronAPI.clearWebviewCache();
        if (nsWebview) {
          nsWebview.reload();
        }
      } catch {
        showError('Ошибка обновления веб-клиента');
      } finally {
        setTimeout(() => {
          panelRefreshBtn.style.pointerEvents = 'auto';
          panelRefreshBtn.style.opacity = '1';
        }, 500);
      }
    });
  }

  if (panelSettingsBtn) {
    panelSettingsBtn.addEventListener('click', () => {
      isSettingsOpen = true;
      pttSettingsPanel.classList.add('visible');
      pttCaptureArea.classList.add('active');
      pttCaptureArea.textContent = 'Наведите курсор на это поле и нажмите клавиши...';
      capturedHotkey.clear();
      isMouseInCaptureZone = false;
      window.electronAPI?.startKeyCapture?.().catch(() => {});
    });
  }

  if (pttCancelBtn) {
    pttCancelBtn.addEventListener('click', () => {
      isSettingsOpen = false;
      pttSettingsPanel.classList.remove('visible');
      pttCaptureArea.classList.remove('active');
      isMouseInCaptureZone = false;
      window.electronAPI?.getPTTHotkey?.().then(updateSettingsTooltip);
      window.electronAPI?.stopKeyCapture?.();
    });
  }

  if (pttSaveBtn) {
    pttSaveBtn.addEventListener('click', async () => {
      const codes = Array.from(capturedHotkey);
      if (codes.length > 0) {
        const res = await window.electronAPI.setPTTHotkey(codes);
        if (res?.success) {
          pttCaptureArea.textContent = `✅ Сохранено: ${codes.join(' + ')}`;
          updateSettingsTooltip(codes);
          setTimeout(() => {
            pttSettingsPanel.classList.remove('visible');
            pttCaptureArea.classList.remove('active');
            isSettingsOpen = false;
            isMouseInCaptureZone = false;
            window.electronAPI?.stopKeyCapture?.();
          }, 1000);
        } else {
          pttCaptureArea.textContent = '❌ Ошибка сохранения';
        }
      } else {
        pttCaptureArea.textContent = '⚠️ Сначала нажмите клавиши!';
      }
    });
  }

  if (pttCaptureArea) {
    pttCaptureArea.addEventListener('mouseenter', () => {
      isMouseInCaptureZone = true;
      if (capturedHotkey.size === 0) {
        pttCaptureArea.textContent = 'Запись... Нажмите клавиши';
      }
    });
    pttCaptureArea.addEventListener('mouseleave', () => {
      isMouseInCaptureZone = false;
      if (capturedHotkey.size === 0) {
        pttCaptureArea.textContent = 'Наведите курсор и нажмите клавиши...';
      }
    });
  }

  if (backPanel) {
    backPanel.addEventListener('mouseenter', () => {
      clearTimeout(hidePanelTimeout);
      backPanel.classList.add('visible');
    });
    backPanel.addEventListener('mouseleave', () => {
      if (isSettingsOpen || isSoundsPanelOpen) return;
      hidePanelTimeout = setTimeout(() => {
        backPanel.classList.remove('visible');
      }, 500);
    });
  }

  if (panelSoundsBtn) {
    panelSoundsBtn.addEventListener('click', openSoundsPanel);
  }

  if (soundsCloseBtn) {
    soundsCloseBtn.addEventListener('click', () => {
      soundsSectionsPanel.classList.remove('visible');
      isSoundsPanelOpen = false;
    });
  }

  // ========== ОВЕРЛЕЙ ==========
  if (panelTestBtn) {
    panelTestBtn.addEventListener('click', async () => {
      try {
        await window.electronAPI.sendTestToOverlay();
        console.log('[OVERLAY] Test message sent');
        
        panelTestBtn.style.backgroundColor = '#4CAF50';
        setTimeout(() => {
          panelTestBtn.style.backgroundColor = '';
        }, 200);
      } catch (err) {
        console.error('[OVERLAY] Failed to send test:', err);
        panelTestBtn.style.backgroundColor = '#f44336';
        setTimeout(() => {
          panelTestBtn.style.backgroundColor = '';
        }, 200);
      }
    });
  }

  if (window.electronAPI?.onOverlayInput) {
    window.electronAPI.onOverlayInput((text) => {
      console.log('[OVERLAY] Input received:', text);
      
      if (panelTestBtn) {
        panelTestBtn.title = `Последнее: ${text}`;
      }
      
      sendMessageToWebChat(text);
    });
  }

  window.addEventListener('message', (event) => {
    if (event.data?.type === 'CHAT_MESSAGE' && event.data?.source === 'webview') {
      const text = event.data.text;
      console.log('[CHAT] Message from webview:', text);
      
      if (window.electronAPI?.sendMessageToOverlay) {
        window.electronAPI.sendMessageToOverlay(text).catch(err => {
          console.error('[OVERLAY] Failed to send to overlay:', err);
        });
      }
    }
  });

  if (window.electronAPI?.onSoundsDownloadProgress) {
    window.electronAPI.onSoundsDownloadProgress((progress) => {
      if (soundsPanelContent && soundsPanelContent.querySelector('.sounds-loading')) {
        soundsPanelContent.innerHTML = `<div class="sounds-loading">Загрузка: ${progress.current}/${progress.total} (${progress.sound})</div>`;
      }
    });
  }

  window.electronAPI.onProgress((name, progress) => {
    updateAddonProgress(name, progress);
  });

  window.electronAPI.onOperationFinished((name, success) => {
    if (success) {
      refreshAddonStatus(name);
    }
  });

  window.electronAPI.onAddonUpdateAvailable(name => {
    if (name === 'NSQC') {
      refreshAddonStatus(name);
    }
  });

  window.electronAPI.onError(error => {
    showError(error);
    const checkboxes = document.querySelectorAll('.addon-card input[type="checkbox"]');
    checkboxes.forEach(cb => cb.disabled = false);
  });

  if (window.electronAPI?.onKeyCaptured) {
    window.electronAPI.onKeyCaptured(code => {
      if (isMouseInCaptureZone) {
        capturedHotkey.add(code);
        pttCaptureArea.textContent = Array.from(capturedHotkey).join(' + ');
      }
    });
  }

  if (window.electronAPI?.onPTTPressed) {
    window.electronAPI.onPTTPressed(() => {
      if (!isPanelMicActive) {
        isPanelMicActive = true;
        if (panelMicBtn) {
          panelMicBtn.classList.add('active');
          panelMicBtn.title = 'Микрофон активен (PTT)';
        }
        window.electronAPI?.sendToWebClient('toggle-mic', { active: true });
      }
    });
  }

  if (window.electronAPI?.onPTTReleased) {
    window.electronAPI.onPTTReleased(() => {
      if (isPanelMicActive) {
        isPanelMicActive = false;
        if (panelMicBtn) {
          panelMicBtn.classList.remove('active');
          panelMicBtn.title = 'Активировать микрофон';
        }
        window.electronAPI?.sendToWebClient('toggle-mic', { active: false });
      }
    });
  }

  if (window.electronAPI?.onWebClientEvent) {
    window.electronAPI.onWebClientEvent('mic-state', state => {
      if (voiceBtn) {
        voiceBtn.classList.toggle('speaking', state?.speaking);
        voiceBtn.classList.toggle('muted', state?.muted);
        voiceBtn.title = state?.muted ? 'Микрофон выключен' : state?.speaking ? 'Говорите...' : 'Микрофон готов';
      }
      if (panelMicBtn) {
        const active = state?.active || state?.speaking || false;
        if (!isPanelMicActive || active !== isPanelMicActive) {
          isPanelMicActive = active;
          panelMicBtn.classList.toggle('active', isPanelMicActive);
        }
      }
      window.electronAPI?.sendMicState(state);
    });
    window.electronAPI.onWebClientEvent('request-ptt-register', config => {
      if (window.electronAPI?.registerPTTHotkey && config?.hotkey) {
        window.electronAPI.registerPTTHotkey(config.hotkey)
          .then(result => {
            window.electronAPI.sendToWebClient('ptt-register-result', result);
          })
          .catch(() => {});
      }
    });
  }

  if (nsWebview) {
    nsWebview.addEventListener('dom-ready', () => {
      window.electronAPI?.sendToWebClient('electron-config', {
        theme: 'dark',
        language: 'ru'
      });
      
      // Добавляем наблюдатель за сообщениями чата
      nsWebview.executeJavaScript(`
        (function() {
          console.log('[Overlay] Setting up chat observer');
          
          const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
              for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                  const messageSelectors = ['.message', '.chat-message', '.msg', '[data-message]'];
                  for (const selector of messageSelectors) {
                    if (node.matches && node.matches(selector)) {
                      const text = node.textContent || '';
                      if (text.trim()) {
                        window.postMessage({ 
                          type: 'CHAT_MESSAGE', 
                          text: text, 
                          source: 'webview' 
                        }, '*');
                      }
                      break;
                    }
                  }
                }
              }
            }
          });
          
          observer.observe(document.body, {
            childList: true,
            subtree: true
          });
        })();
      `).catch(() => {});
    });
    
    nsWebview.addEventListener('did-fail-load', event => {
      showError('Не удалось загрузить веб-клиент: ' + (event.errorDescription || 'Unknown error'));
    });
    
    nsWebview.addEventListener('ipc-message', (event) => {
      if (event.channel === 'play-sound') {
        const soundType = event.args[0];
        window.electronAPI.playSound(soundType).catch(() => {});
      }
    });
    
    nsWebview.addEventListener('dom-ready', () => {
      nsWebview.executeJavaScript(`
        (function() {
          window.addEventListener('message', (event) => {
            if (event.data?.type === 'ELECTRON_PLAY_SOUND' && event.data?.soundType) {
              if (window.ipcRenderer) {
                window.ipcRenderer.sendToHost('play-sound', event.data.soundType);
              }
            }
            if (event.data?.type === 'PLAY_SOUND' && event.data?.soundType) {
              if (window.ipcRenderer) {
                window.ipcRenderer.sendToHost('play-sound', event.data.soundType);
              }
            }
          });
        })();
      `).catch(() => {});
    });
    
    nsWebview.addEventListener('console-message', (event) => {
      const message = event.message;
      let soundType = null;
      if (message.includes('[WebView] ✓ Sent via postMessage:')) {
        const match = message.match(/postMessage:\s*(\w+-\w+)/);
        if (match) {
          soundType = match[1];
        }
      } else if (message.includes('playSound called with:') && message.includes('[CLIENT]')) {
        const match = message.match(/playSound called with:\s*(\w+-\w+)/);
        if (match) {
          soundType = match[1];
        }
      }
      if (soundType) {
        window.electronAPI.playSound(soundType).catch(() => {});
      }
    });
  }

  window.addEventListener('message', (event) => {
    if (event.data?.type === 'COPY_TO_CLIPBOARD' && event.data?.text) {
      window.electronAPI?.copyToClipboard(event.data.text).catch(() => {});
    }
  });
});