document.addEventListener('DOMContentLoaded', () => {
    // === Отладка: логгер для renderer ===
    function loggerDebug(message) {
        console.debug(`[NightWatchRenderer] ${message}`);
    }
    
    loggerDebug('DOM loaded, initializing...');

    const gameStatus = document.getElementById('game-status');
    const launchBtn = document.getElementById('launch-btn');
    const addonsList = document.getElementById('addons-list');
    const logsBtn = document.getElementById('logs-btn');
    const voiceBtn = document.getElementById('voice-btn');
    const changePathBtn = document.getElementById('change-path-btn');

    // WebView и контейнер
    const webviewContainer = document.getElementById('webview-container');
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
    loggerDebug('Starting initialization: loadAddons, checkGame');
    loadAddons();
    checkGame();

    // === Обработчики кнопок ===
    launchBtn.addEventListener('click', () => {
        loggerDebug('Launch button clicked');
        launchGame();
    });
    
    logsBtn.addEventListener('click', () => {
        loggerDebug('Logs button clicked');
        openLogsFolder();
    });
    
    changePathBtn.addEventListener('click', () => {
        loggerDebug('Change path button clicked');
        changeGamePath();
    });

    // === Кнопка микрофона → переключение на веб-клиент ===
    voiceBtn.addEventListener('click', async () => {
        loggerDebug('Voice button clicked, switching to webview');
        isWebViewVisible = true;
        await toggleView();
    });

    // === Кнопка "Назад" → возврат к менеджеру аддонов ===
    backBtn.addEventListener('click', () => {
        loggerDebug('Back button clicked, switching to addons');
        isWebViewVisible = false;
        toggleView();
    });

    // === Логика скрытия/показа панели ===
    if (backPanel) {
        backPanel.addEventListener('mouseenter', () => {
            clearTimeout(hidePanelTimeout);
            backPanel.classList.add('visible');
            loggerDebug('Back panel: mouseenter, showing');
        });

        backPanel.addEventListener('mouseleave', () => {
            hidePanelTimeout = setTimeout(() => {
                backPanel.classList.remove('visible');
                loggerDebug('Back panel: mouseleave, hiding after delay');
            }, 500);
        });
    }

    // === Подписка на события Electron API ===
    window.electronAPI.onProgress((name, progress) => {
        loggerDebug(`Progress event: ${name} = ${Math.round(progress * 100)}%`);
        updateAddonProgress(name, progress);
    });

    window.electronAPI.onOperationFinished((name, success) => {
        loggerDebug(`Operation finished: ${name}, success=${success}`);
        if (success) {
            refreshAddonStatus(name);
        }
    });

    window.electronAPI.onAddonUpdateAvailable((name) => {
        loggerDebug(`Update available: ${name}`);
        if (name === 'NSQC') {
            refreshAddonStatus(name);
        }
    });

    window.electronAPI.onError((error) => {
        loggerDebug(`Error event: ${error}`);
        showError(error);
        document.querySelectorAll('.addon-card input[type="checkbox"]').forEach(checkbox => {
            checkbox.disabled = false;
        });
    });

    // === Слушатели событий от веб-клиента ===
    if (window.electronAPI?.onWebClientEvent) {
        window.electronAPI.onWebClientEvent('mic-state', (state) => {
            loggerDebug(`WebClient mic-state: ${JSON.stringify(state)}`);
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
            loggerDebug(`WebClient request-ptt-register: ${JSON.stringify(config)}`);
            if (window.electronAPI?.registerPTTHotkey && config?.hotkey) {
                window.electronAPI.registerPTTHotkey(config.hotkey)
                    .then(result => {
                        loggerDebug(`PTT register result: ${JSON.stringify(result)}`);
                        window.electronAPI.sendToWebClient('ptt-register-result', result);
                    })
                    .catch(err => {
                        loggerDebug(`PTT register error: ${err}`);
                    });
            }
        });
    }

    // === PTT: при активации хоткея отправляем сигнал во фрейм ===
    if (window.electronAPI?.onPTTActivated) {
        window.electronAPI.onPTTActivated(() => {
            loggerDebug('PTT activated, signal sent to web client');
        });
    }

    // === События webview ===
    if (nsWebview) {
        nsWebview.addEventListener('dom-ready', () => {
            loggerDebug('Web client frame dom-ready');
            if (window.electronAPI?.sendToWebClient) {
                // Отправляем базовую конфигурацию
                window.electronAPI.sendToWebClient('electron-config', {
                    theme: 'dark',
                    language: 'ru'
                });
            }
        });

        nsWebview.addEventListener('did-fail-load', (event) => {
            loggerDebug(`Web client failed to load: ${JSON.stringify(event)}`);
            showError('Не удалось загрузить веб-клиент: ' + (event.errorDescription || 'Unknown error'));
        });
        
        nsWebview.addEventListener('console-message', (event) => {
            // Перенаправляем логи из webview в консоль с префиксом
            console.debug(`[WebView] ${event.message}`);
        });
    }

    // === Функция переключения вида (async для получения платформы) ===
    async function toggleView() {
        loggerDebug(`toggleView() called, isWebViewVisible=${isWebViewVisible}`);
        
        if (isWebViewVisible) {
            // Показываем контейнер
            if (webviewContainer) {
                webviewContainer.classList.add('active');
                loggerDebug('WebView container: added active class');
            }

            // Скрываем элементы менеджера аддонов
            if (topBar) topBar.style.display = 'none';
            if (gamePanel) gamePanel.style.display = 'none';
            if (divider) divider.style.display = 'none';
            if (addonsHeader) addonsHeader.style.display = 'none';
            if (addonsList) addonsList.style.display = 'none';
            if (backPanel) backPanel.style.display = 'block';
            if (voiceBtn) voiceBtn.style.display = 'none';
            loggerDebug('Hidden addon manager UI elements');

            // Отправляем сигнал готовности в webview
            if (window.electronAPI?.sendToWebClient) {
                try {
                    // Получаем платформу через IPC (вместо process.platform)
                    const platform = await window.electronAPI.getPlatform();
                    loggerDebug(`Got platform via IPC: ${platform}`);
                    
                    window.electronAPI.sendToWebClient('electron-ready', {
                        version: '1.0.0',
                        platform: platform || 'unknown',
                        userAgent: navigator.userAgent
                    });
                    loggerDebug('Sent electron-ready to web client');
                } catch (err) {
                    loggerDebug(`Error getting platform: ${err}`);
                    // Fallback на неизвестную платформу
                    window.electronAPI.sendToWebClient('electron-ready', {
                        version: '1.0.0',
                        platform: 'unknown',
                        userAgent: navigator.userAgent
                    });
                }
            }
        } else {
            // Скрываем контейнер
            if (webviewContainer) {
                webviewContainer.classList.remove('active');
                loggerDebug('WebView container: removed active class');
            }

            // Возвращаем исходное состояние
            if (topBar) topBar.style.display = 'flex';
            if (gamePanel) gamePanel.style.display = 'flex';
            if (divider) divider.style.display = 'block';
            if (addonsHeader) addonsHeader.style.display = 'flex';
            if (addonsList) addonsList.style.display = 'block';
            if (backPanel) backPanel.style.display = 'none';
            backPanel?.classList.remove('visible');
            if (voiceBtn) voiceBtn.style.display = 'block';
            loggerDebug('Restored addon manager UI elements');
        }
    }

    // === Функции ===
    async function loadAddons() {
        loggerDebug('loadAddons() called');
        try {
            const addons = await window.electronAPI.loadAddons();
            loggerDebug(`loadAddons() completed, received ${Object.keys(addons).length} addons`);
            renderAddons(addons);
        } catch (error) {
            loggerDebug(`loadAddons() error: ${error}`);
            showError('Не удалось загрузить список аддонов');
        }
    }

    function renderAddons(addons) {
        loggerDebug(`renderAddons() called with ${Object.keys(addons).length} addons`);
        addonsList.innerHTML = '';
        for (const [name, addon] of Object.entries(addons)) {
            const addonElement = createAddonElement(name, addon);
            addonsList.appendChild(addonElement);
        }
    }

    function createAddonElement(name, addon) {
        loggerDebug(`createAddonElement() for ${name}, installed=${addon.installed}`);
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
            loggerDebug(`Checkbox changed for ${name}: willInstall=${willInstall}`);

            checkbox.disabled = true;
            card.classList.remove('deleting-warning');

            window.electronAPI.toggleAddon(name, willInstall)
                .then(success => {
                    loggerDebug(`toggleAddon result for ${name}: ${success}`);
                    if (!success) {
                        checkbox.checked = originalState;
                    }
                })
                .catch(error => {
                    loggerDebug(`toggleAddon error for ${name}: ${error}`);
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
        loggerDebug(`refreshAddonStatus() for ${name}`);
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
            loggerDebug(`refreshAddonStatus error: ${error}`);
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
        loggerDebug('checkGame() called');
        window.electronAPI.checkGame().then(exists => {
            loggerDebug(`checkGame result: exists=${exists}`);
            gameStatus.textContent = exists ? 'Готова к запуску' : 'Игра не найдена';
            gameStatus.style.color = exists ? '#4CAF50' : '#F44336';
            launchBtn.disabled = !exists;
        }).catch((err) => {
            loggerDebug(`checkGame error: ${err}`);
            gameStatus.textContent = 'Ошибка проверки игры';
            gameStatus.style.color = '#F44336';
            launchBtn.disabled = true;
        });
    }

    async function launchGame() {
        loggerDebug('launchGame() called');
        const success = await window.electronAPI.launchGame();
        if (!success) {
            loggerDebug('launchGame failed');
            showError('Не удалось запустить игру');
        } else {
            loggerDebug('launchGame succeeded');
        }
    }

    function openLogsFolder() {
        loggerDebug('openLogsFolder() called');
        window.electronAPI.openLogsFolder();
    }

    async function changeGamePath() {
        loggerDebug('changeGamePath() called');
        const success = await window.electronAPI.changeGamePath();
        if (success) {
            loggerDebug('changeGamePath succeeded, refreshing UI');
            checkGame();
            loadAddons();
        } else {
            loggerDebug('changeGamePath canceled or failed');
        }
    }

    function showError(message) {
        loggerDebug(`showError: ${message}`);
        alert(`Ошибка: ${message}`);
    }
    
    loggerDebug('Renderer initialization complete');
});