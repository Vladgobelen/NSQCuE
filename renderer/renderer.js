document.addEventListener('DOMContentLoaded', function() {
    var gameStatus = document.getElementById('game-status');
    var launchBtn = document.getElementById('launch-btn');
    var addonsList = document.getElementById('addons-list');
    var logsBtn = document.getElementById('logs-btn');
    var voiceBtn = document.getElementById('voice-btn');
    var changePathBtn = document.getElementById('change-path-btn');
    var webviewContainer = document.getElementById('webview-container');
    var nsWebview = document.getElementById('ns-webview');
    var backPanel = document.getElementById('back-panel');
    var backBtn = document.getElementById('back-btn');
    var panelMicBtn = document.getElementById('panel-mic-btn');
    var panelRefreshBtn = document.getElementById('panel-refresh-btn');
    var panelSettingsBtn = document.getElementById('panel-settings-btn');
    var panelSoundsBtn = document.getElementById('panel-sounds-btn');
    var panelAccountsBtn = document.getElementById('panel-accounts-btn');
    var pttSettingsPanel = document.getElementById('ptt-settings-panel');
    var pttCaptureArea = document.getElementById('ptt-capture-area');
    var pttSaveBtn = document.getElementById('ptt-save-btn');
    var pttCancelBtn = document.getElementById('ptt-cancel-btn');
    var soundsSectionsPanel = document.getElementById('sounds-sections-panel');
    var soundsPanelContent = document.getElementById('sounds-panel-content');
    var soundsCloseBtn = document.getElementById('sounds-close-btn');
    var topBar = document.getElementById('top-bar');
    var gamePanel = document.getElementById('game-panel');
    var divider = document.getElementById('divider');
    var addonsHeader = document.getElementById('addons-header');

    var isWebViewVisible = false;
    var hidePanelTimeout = null;
    var isPanelMicActive = false;
    var capturedHotkey = new Set();
    var isSettingsOpen = false;
    var isSoundsPanelOpen = false;
    var isMouseInCaptureZone = false;
    var isGameReady = false;
    var isLaunchBlocked = false;
    var isLoadingAddons = false;
    // ✅ Изменение 2: Флаг установки аддонов
    var isAddonInstalling = false;

    // ✅ Обновлённая функция: учитывает флаг isAddonInstalling
    function updateLaunchButtonState() {
        if (launchBtn) {
            launchBtn.disabled = !isGameReady || isLaunchBlocked || isAddonInstalling;

            if (isAddonInstalling) {
                launchBtn.textContent = 'Установка аддонов...';
            } else {
                launchBtn.textContent = 'Запустить игру';
            }
        }
    }

    function formatHotkey(codes) {
        if (!codes || !Array.isArray(codes) || codes.length === 0) {
            return 'Не задан';
        }
        var keyNames = {
            16: 'Shift', 17: 'Ctrl', 18: 'Alt', 32: 'Space', 27: 'Esc', 13: 'Enter',
            9: 'Tab', 8: 'Backspace', 46: 'Del', 37: '←', 38: '↑', 39: '→', 40: '↓',
            112: 'F1', 113: 'F2', 114: 'F3', 115: 'F4', 116: 'F5', 117: 'F6', 118: 'F7', 119: 'F8',
            120: 'F9', 121: 'F10', 122: 'F11', 123: 'F12',
            272: 'Mouse4', 273: 'Mouse5', 276: 'MouseLeft', 277: 'MouseRight', 278: 'MouseMiddle'
        };
        return codes.map(function(code) { return keyNames[code] || 'K' + code; }).join(' + ');
    }

    function updateSettingsTooltip(codes) {
        if (panelSettingsBtn) {
            panelSettingsBtn.title = 'PTT: ' + formatHotkey(codes);
        }
    }

    function showError(message) {
        alert('Ошибка: ' + message);
    }

    function showAddonsLoading() {
        addonsList.innerHTML = '<div class="addons-loading">' +
            '<div class="addons-loading-spinner"></div>' +
            '<div class="addons-loading-text" id="addons-loading-text">Поиск списка аддонов...</div>' +
            '<div class="addons-loading-source" id="addons-loading-source"></div>' +
            '</div>';
    }

    function showAddonsError() {
        addonsList.innerHTML = '<div class="addons-loading">' +
            '<div class="addons-loading-text">⚠️ Не удалось загрузить список аддонов</div>' +
            '<button class="addons-retry-btn" id="addons-retry-btn">Повторить</button>' +
            '</div>';
        document.getElementById('addons-retry-btn').addEventListener('click', function() {
            loadAddons();
        });
    }

    async function loadAddons() {
        isLoadingAddons = true;
        showAddonsLoading();
        try {
            var addons = await window.electronAPI.loadAddons();
            renderAddons(addons);
        } catch (e) {
            showAddonsError();
        } finally {
            isLoadingAddons = false;
        }
    }

    function renderAddons(addons) {
        addonsList.innerHTML = '';
        for (var name in addons) {
            if (addons.hasOwnProperty(name)) {
                addonsList.appendChild(createAddonElement(name, addons[name]));
            }
        }
    }

    function createAddonElement(name, addon) {
        var card = document.createElement('div');
        card.className = 'addon-card';
        card.dataset.name = name;

        var contentWrapper = document.createElement('div');
        contentWrapper.className = 'addon-content-wrapper';

        var overlay = document.createElement('div');
        overlay.className = 'progress-overlay hidden';
        card.overlay = overlay;

        var topRow = document.createElement('div');
        topRow.className = 'addon-top';

        var nameEl = document.createElement('span');
        nameEl.className = 'addon-name';
        nameEl.textContent = name;

        var updateLabel = document.createElement('span');
        updateLabel.className = 'update-label';
        updateLabel.style.display = addon.needs_update ? 'inline' : 'none';
        updateLabel.textContent = 'Доступно обновление';

        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = 'checkbox-' + name;
        checkbox.checked = addon.installed;
        checkbox.disabled = addon.being_processed || addon.updating;

        var label = document.createElement('label');
        label.htmlFor = 'checkbox-' + name;
        label.className = 'custom-checkbox';

        topRow.append(nameEl, updateLabel, checkbox, label);

        var description = document.createElement('div');
        description.className = 'addon-description';
        description.textContent = addon.description;

        card.checkbox = checkbox;
        card.updateLabel = updateLabel;
        card.appendChild(overlay);
        contentWrapper.append(topRow, description);
        card.appendChild(contentWrapper);

        if (addon.installed) {
            card.onmouseenter = function() { card.classList.add('deleting-warning'); };
            card.onmouseleave = function() { card.classList.remove('deleting-warning'); };
        }

        // ✅ Обновлённый обработчик: блокирует кнопку запуска во время установки
        checkbox.addEventListener('change', function() {
            var willInstall = checkbox.checked;
            var originalState = !willInstall;
            checkbox.disabled = true;
            card.classList.remove('deleting-warning');

            isAddonInstalling = true;
            updateLaunchButtonState();

            window.electronAPI.toggleAddon(name, willInstall)
                .then(function(success) {
                    if (!success) {
                        checkbox.checked = originalState;
                    }
                })
                .catch(function() {
                    checkbox.checked = originalState;
                    checkbox.disabled = false;
                })
                .finally(function() {
                    isAddonInstalling = false;
                    updateLaunchButtonState();
                });
        });

        return card;
    }

    function updateAddonProgress(name, progress) {
        var cards = document.querySelectorAll('.addon-card');
        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            if (card.dataset.name === name && card.overlay) {
                card.overlay.style.setProperty('--progress', Math.min(progress, 1.0) * 100 + '%');
                card.overlay.classList.toggle('hidden', progress <= 0);
                card.overlay.style.opacity = progress > 0 ? '1' : '0';

                if (progress >= 1.0) {
                    setTimeout(function() {
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
            .then(function(addons) {
                var addon = addons[name];
                if (!addon) return;

                var cards = document.querySelectorAll('.addon-card');
                for (var i = 0; i < cards.length; i++) {
                    var card = cards[i];
                    if (card.dataset.name === name) {
                        card.checkbox.disabled = false;
                        card.checkbox.checked = addon.installed;

                        if (card.overlay) {
                            card.overlay.classList.add('hidden');
                            card.overlay.style.opacity = '0';
                            card.overlay.style.setProperty('--progress', '0%');
                        }

                        if (addon.installed) {
                            card.onmouseenter = function() { card.classList.add('deleting-warning'); };
                            card.onmouseleave = function() { card.classList.remove('deleting-warning'); };
                        } else {
                            card.onmouseenter = null;
                            card.onmouseleave = null;
                        }

                        card.updateLabel.style.display = addon.needs_update ? 'inline' : 'none';
                        break;
                    }
                }
            })
            .catch(function() {
                var cards = document.querySelectorAll('.addon-card');
                for (var i = 0; i < cards.length; i++) {
                    var card = cards[i];
                    if (card.dataset.name === name) {
                        card.checkbox.disabled = false;
                    }
                }
            });
    }

    function checkGame() {
        window.electronAPI.checkGame()
            .then(function(exists) {
                isGameReady = exists;
                gameStatus.textContent = exists ? 'Готова к запуску' : 'Игра не найдена';
                gameStatus.style.color = exists ? '#4CAF50' : '#F44336';
                updateLaunchButtonState();
            })
            .catch(function() {
                isGameReady = false;
                gameStatus.textContent = 'Ошибка проверки игры';
                gameStatus.style.color = '#F44336';
                updateLaunchButtonState();
            });
    }

    // ✅ Обновлённая функция: проверка флага установки
    async function launchGame() {
        if (isAddonInstalling) {
            showError('Дождитесь завершения установки аддонов');
            return;
        }

        var result = await window.electronAPI.launchGame();
        if (!result) {
            showError('Не удалось запустить игру');
        }
    }

    function openLogsFolder() {
        window.electronAPI.openLogsFolder();
    }

    async function changeGamePath() {
        var result = await window.electronAPI.changeGamePath();
        if (result) {
            checkGame();
            loadAddons();
        }
    }

    async function toggleView() {
        if (isWebViewVisible) {
            if (webviewContainer) webviewContainer.classList.add('active');
            topBar.style.display = 'none';
            gamePanel.style.display = 'none';
            divider.style.display = 'none';
            addonsHeader.style.display = 'none';
            addonsList.style.display = 'none';
            backPanel.style.display = 'flex';
            voiceBtn.style.display = 'none';

            try {
                var platform = await window.electronAPI.getPlatform();
                window.electronAPI.sendToWebClient('electron-ready', {
                    version: '1.0.0',
                    platform: platform || 'unknown',
                    userAgent: navigator.userAgent
                });
            } catch (e) {
                window.electronAPI.sendToWebClient('electron-ready', {
                    version: '1.0.0',
                    platform: 'unknown',
                    userAgent: navigator.userAgent
                });
            }

            setTimeout(async function() {
                try {
                    var creds = await window.electronAPI.loadCredentials();
                    if (creds && creds.username && creds.password) {
                        var fillCode = '(function() { var u = document.querySelector("#usernameInput, input[name=\\"username\\"], input[placeholder*=\\"Ник\\"]"); var p = document.querySelector("#passwordInput, input[type=\\"password\\"]"); if (u && p) { u.value = "' + creds.username.replace(/"/g, '\\"') + '"; p.value = "' + creds.password.replace(/"/g, '\\"') + '"; var b = document.querySelector("#authSubmitBtn, button:contains(\'Войти\')"); if (b) b.click(); } })();';
                        nsWebview.executeJavaScript(fillCode).catch(function() {});
                    }
                } catch (e) {}
            }, 2000);
        } else {
            if (webviewContainer) webviewContainer.classList.remove('active');
            topBar.style.display = 'flex';
            gamePanel.style.display = 'flex';
            divider.style.display = 'block';
            addonsHeader.style.display = 'flex';
            addonsList.style.display = 'block';
            backPanel.style.display = 'none';
            backPanel.classList.remove('visible');
            voiceBtn.style.display = 'block';

            if (window.electronAPI && window.electronAPI.updateTrayBadge) {
                window.electronAPI.updateTrayBadge(0);
            }
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
            var customBtn = document.createElement('button');
            customBtn.className = 'sounds-section-btn';
            customBtn.textContent = '📁 Свои';
            customBtn.title = 'Открыть папку с кастомными звуками';
            customBtn.addEventListener('click', function() {
                window.electronAPI.openSoundsFolder();
            });
            soundsPanelContent.appendChild(customBtn);

            var dividerEl = document.createElement('div');
            dividerEl.className = 'sounds-divider';
            soundsPanelContent.appendChild(dividerEl);

            var config = await window.electronAPI.fetchSoundsConfig();
            soundsPanelContent.innerHTML = '';
            soundsPanelContent.appendChild(customBtn);
            soundsPanelContent.appendChild(dividerEl);

            if (!config || !config.sections) {
                soundsPanelContent.innerHTML = '<div class="sounds-error">Разделы не найдены</div>';
                return;
            }

            var sections = Object.keys(config.sections);
            for (var i = 0; i < sections.length; i++) {
                var sectionName = sections[i];
                var btn = document.createElement('button');
                btn.className = 'sounds-section-btn';
                btn.textContent = sectionName;
                btn.addEventListener('click', (function(sn) {
                    return function() { downloadSectionSounds(sn); };
                })(sectionName));
                soundsPanelContent.appendChild(btn);
            }
        } catch (err) {
            soundsPanelContent.innerHTML = '<div class="sounds-error">Ошибка: ' + err.message + '</div>';
        }
    }

    async function downloadSectionSounds(sectionName) {
        soundsPanelContent.innerHTML = '<div class="sounds-loading">Загрузка раздела "' + sectionName + '"...</div>';
        try {
            await window.electronAPI.downloadSoundsSection(sectionName);
            soundsPanelContent.innerHTML = '<div class="sounds-success">✅ Раздел "' + sectionName + '" загружен</div>';
        } catch (err) {
            soundsPanelContent.innerHTML = '<div class="sounds-error">❌ Ошибка: ' + err.message + '</div>';
        }
    }

    function sendMessageToWebChat(text) {
        var webview = document.getElementById('ns-webview');
        if (!webview) return;

        var escapedText = text.replace(/'/g, "\\'").replace(/"/g, '\\"');
        var code = '(function() { var s = ["input[type=\\"text\\"]", "textarea", "[contenteditable=\\"true\\"]", ".chat-input", "#chat-input", ".message-input"]; var i = null; for (var j = 0; j < s.length; j++) { i = document.querySelector(s[j]); if (i) break; } if (i && (i.tagName === "INPUT" || i.tagName === "TEXTAREA")) { i.value = "' + escapedText + '"; i.dispatchEvent(new Event("input", { bubbles: true })); var b = document.querySelector("button[type=\\"submit\\"], .send-button, #send-button"); if (b) { b.click(); } else { i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true })); } return true; } return false; })();';

        webview.executeJavaScript(code).catch(function(err) {
            console.error('[OVERLAY] Error sending to web chat:', err);
        });
    }

    function showAccountsModal() {
        if (!nsWebview) {
            alert('Веб-клиент не загружен');
            return;
        }

        var modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:100000;';
        modal.innerHTML = '<div style="background:#252525;border:1px solid #555;border-radius:10px;padding:20px;min-width:300px;max-width:400px;"><h3 style="color:white;margin-bottom:15px;text-align:center;">Аккаунты</h3><div id="accounts-list-container" style="max-height:300px;overflow-y:auto;"><div style="color:#aaa;text-align:center;padding:20px;">Загрузка...</div></div><div style="margin-top:15px;display:flex;gap:10px;justify-content:space-between;"><button id="add-account-btn" style="padding:8px 16px;background:#2a82da;border:none;border-radius:5px;color:white;cursor:pointer;">➕ Добавить</button><button id="close-modal-btn" style="padding:8px 16px;background:#3d3d3d;border:1px solid #555;border-radius:5px;color:white;cursor:pointer;">Закрыть</button></div></div>';
        document.body.appendChild(modal);

        var accountsContainer = document.getElementById('accounts-list-container');
        modal.querySelector('#close-modal-btn').onclick = function() { modal.remove(); };
        modal.onclick = function(e) { if (e.target === modal) modal.remove(); };

        modal.querySelector('#add-account-btn').onclick = function() {
            nsWebview.executeJavaScript('(function() { localStorage.removeItem("voicechat_lastuser"); location.reload(); })();');
            modal.remove();
        };

        nsWebview.executeJavaScript(`
            (function() {
                var accounts = JSON.parse(localStorage.getItem('voicechat_accounts') || '[]');
                var current = JSON.parse(localStorage.getItem('voicechat_lastuser') || 'null');
                return { accounts: accounts, current: current };
            })();
        `).then(function(result) {
            var accounts = result.accounts || [];
            var current = result.current;
            var accountsHtml = '';

            for (var i = 0; i < accounts.length; i++) {
                var acc = accounts[i];
                var isCurrent = (current && acc.userId === current.userId);
                accountsHtml += '<div class="account-item" data-userid="' + acc.userId + '" style="padding:10px;margin:5px 0;background:' + (isCurrent ? '#2a82da' : '#3d3d3d') + ';border-radius:5px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;"><span style="color:white;">' + acc.username + (isCurrent ? ' ✓' : '') + '</span><button class="delete-account" data-userid="' + acc.userId + '" style="background:none;border:none;color:#f44336;cursor:pointer;font-size:16px;">✕</button></div>';
            }

            accountsContainer.innerHTML = accountsHtml || '<div style="color:#aaa;text-align:center;padding:20px;">Нет сохранённых аккаунтов</div>';

            var items = accountsContainer.querySelectorAll('.account-item');
            for (var i = 0; i < items.length; i++) {
                items[i].onclick = (function(acc) {
                    return function(e) {
                        if (e.target.classList.contains('delete-account')) return;
                        if (current && acc.userId === current.userId) return;
                        nsWebview.executeJavaScript('(function() { localStorage.setItem("voicechat_lastuser", JSON.stringify(' + JSON.stringify(acc) + ')); location.reload(); })();');
                        modal.remove();
                    };
                })(accounts[i]);
            }

            var deleteButtons = accountsContainer.querySelectorAll('.delete-account');
            for (var i = 0; i < deleteButtons.length; i++) {
                deleteButtons[i].onclick = (function(acc) {
                    return function(e) {
                        e.stopPropagation();
                        var newAccounts = accounts.filter(function(a) { return a.userId !== acc.userId; });
                        nsWebview.executeJavaScript('(function() { localStorage.setItem("voicechat_accounts", JSON.stringify(' + JSON.stringify(newAccounts) + ')); })();');
                        modal.remove();
                        showAccountsModal();
                    };
                })(accounts[i]);
            }
        }).catch(function() {
            accountsContainer.innerHTML = '<div style="color:#f44336;text-align:center;padding:20px;">Ошибка загрузки аккаунтов</div>';
        });
    }

        if (window.electronAPI && window.electronAPI.onConfigSourceStatus) {
        window.electronAPI.onConfigSourceStatus(function(data) {
            if (!isLoadingAddons) return;
            var textEl = document.getElementById('addons-loading-text');
            var sourceEl = document.getElementById('addons-loading-source');
            if (!sourceEl) return;
            var host = data.url.replace(/^https?:\/\//, '').split('/')[0];
            if (data.state === 'trying') {
                if (textEl) textEl.textContent = 'Поиск списка аддонов (источник ' + data.index + ' из ' + data.total + ')...';
                sourceEl.textContent = '⏳ ' + host;
            } else if (data.state === 'failed') {
                sourceEl.textContent = '❌ ' + host;
            } else if (data.state === 'loaded') {
                sourceEl.textContent = '✅ ' + host;
            }
        });
    }

    loadAddons();
    checkGame();

    (async function() {
        try {
            var saved = await window.electronAPI.getPTTHotkey();
            updateSettingsTooltip(saved);
        } catch (e) {
            updateSettingsTooltip(null);
        }
    })();

    if (window.electronAPI && window.electronAPI.onBlockLaunchGame) {
        window.electronAPI.onBlockLaunchGame(function(blocked) {
            isLaunchBlocked = blocked;
            updateLaunchButtonState();
        });
    }

    launchBtn.addEventListener('click', function() { launchGame(); });
    logsBtn.addEventListener('click', function() { openLogsFolder(); });
    changePathBtn.addEventListener('click', function() { changeGamePath(); });

    voiceBtn.addEventListener('click', async function() {
        isWebViewVisible = true;
        await toggleView();
    });

    backBtn.addEventListener('click', function() {
        isWebViewVisible = false;
        toggleView();
    });

    if (panelMicBtn) {
        panelMicBtn.addEventListener('click', function() {
            isPanelMicActive = !isPanelMicActive;
            panelMicBtn.classList.toggle('active', isPanelMicActive);
            panelMicBtn.title = isPanelMicActive ? 'Микрофон активен (выкл)' : 'Активировать микрофон';
            if (window.electronAPI) {
                window.electronAPI.sendToWebClient('toggle-mic', { active: isPanelMicActive });
            }
        });
    }

    if (panelRefreshBtn) {
        panelRefreshBtn.addEventListener('click', async function() {
            panelRefreshBtn.style.pointerEvents = 'none';
            panelRefreshBtn.style.opacity = '0.5';
            try {
                await window.electronAPI.clearWebviewCache();
                if (nsWebview) nsWebview.reload();
            } catch (e) {
                showError('Ошибка обновления веб-клиента');
            } finally {
                setTimeout(function() {
                    panelRefreshBtn.style.pointerEvents = 'auto';
                    panelRefreshBtn.style.opacity = '1';
                }, 500);
            }
        });
    }

    if (panelSettingsBtn) {
        panelSettingsBtn.addEventListener('click', function() {
            isSettingsOpen = true;
            pttSettingsPanel.classList.add('visible');
            pttCaptureArea.classList.add('active');
            pttCaptureArea.textContent = 'Наведите курсор на это поле и нажмите клавиши...';
            capturedHotkey.clear();
            isMouseInCaptureZone = false;
            if (window.electronAPI && window.electronAPI.startKeyCapture) {
                window.electronAPI.startKeyCapture().catch(function() {});
            }
        });
    }

    if (pttCancelBtn) {
        pttCancelBtn.addEventListener('click', function() {
            isSettingsOpen = false;
            pttSettingsPanel.classList.remove('visible');
            pttCaptureArea.classList.remove('active');
            isMouseInCaptureZone = false;
            if (window.electronAPI && window.electronAPI.getPTTHotkey) {
                window.electronAPI.getPTTHotkey().then(updateSettingsTooltip);
            }
            if (window.electronAPI && window.electronAPI.stopKeyCapture) {
                window.electronAPI.stopKeyCapture();
            }
        });
    }

    if (pttSaveBtn) {
        pttSaveBtn.addEventListener('click', async function() {
            var codes = Array.from(capturedHotkey);
            if (codes.length > 0) {
                var res = await window.electronAPI.setPTTHotkey(codes);
                if (res && res.success) {
                    pttCaptureArea.textContent = '✅ Сохранено: ' + codes.join(' + ');
                    updateSettingsTooltip(codes);
                    setTimeout(function() {
                        pttSettingsPanel.classList.remove('visible');
                        pttCaptureArea.classList.remove('active');
                        isSettingsOpen = false;
                        isMouseInCaptureZone = false;
                        if (window.electronAPI && window.electronAPI.stopKeyCapture) {
                            window.electronAPI.stopKeyCapture();
                        }
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
        pttCaptureArea.addEventListener('mouseenter', function() {
            isMouseInCaptureZone = true;
            if (capturedHotkey.size === 0) {
                pttCaptureArea.textContent = 'Запись... Нажмите клавиши';
            }
        });

        pttCaptureArea.addEventListener('mouseleave', function() {
            isMouseInCaptureZone = false;
            if (capturedHotkey.size === 0) {
                pttCaptureArea.textContent = 'Наведите курсор и нажмите клавиши...';
            }
        });
    }

    if (backPanel) {
        backPanel.addEventListener('mouseenter', function() {
            clearTimeout(hidePanelTimeout);
            backPanel.classList.add('visible');
        });

        backPanel.addEventListener('mouseleave', function() {
            if (isSettingsOpen || isSoundsPanelOpen) return;
            hidePanelTimeout = setTimeout(function() {
                backPanel.classList.remove('visible');
            }, 500);
        });
    }

    if (panelSoundsBtn) {
        panelSoundsBtn.addEventListener('click', openSoundsPanel);
    }

    if (panelAccountsBtn) {
        panelAccountsBtn.addEventListener('click', showAccountsModal);
    }

    if (soundsCloseBtn) {
        soundsCloseBtn.addEventListener('click', function() {
            soundsSectionsPanel.classList.remove('visible');
            isSoundsPanelOpen = false;
        });
    }

    if (window.electronAPI && window.electronAPI.onOverlayInput) {
        window.electronAPI.onOverlayInput(function(text) {
            sendMessageToWebChat(text);
        });
    }

    window.addEventListener('message', function(event) {
        if (event.data && event.data.type === 'SAVE_CREDENTIALS' && event.data.source === 'webview') {
            var username = event.data.username;
            var password = event.data.password;
            if (username && password && window.electronAPI && window.electronAPI.saveCredentials) {
                window.electronAPI.saveCredentials(username, password).catch(function(err) {
                    console.error('[AUTH] Failed to save credentials:', err);
                });
            }
        }

        if (event.data && event.data.type === 'CHAT_MESSAGE' && event.data.source === 'webview') {
            var text = event.data.text;
            if (window.electronAPI && window.electronAPI.sendMessageToOverlay) {
                window.electronAPI.sendMessageToOverlay(text).catch(function(err) {
                    console.error('[CHAT] Failed to send to overlay:', err);
                });
            }
        }

        if (event.data && event.data.type === 'ELECTRON_SHOW_NOTIFICATION' && event.data.source === 'webview') {
            var title = event.data.title;
            var body = event.data.body;
            if (window.electronAPI && window.electronAPI.showNotification) {
                window.electronAPI.showNotification(title, body);
            }
        }

        if (event.data && event.data.type === 'ELECTRON_UPDATE_TRAY_BADGE' && event.data.source === 'webview') {
            var count = event.data.count;
            if (window.electronAPI && window.electronAPI.updateTrayBadge) {
                window.electronAPI.updateTrayBadge(count);
            }
        }

        if (event.data && event.data.type === 'ELECTRON_SAVE_ACCOUNT' && event.data.source === 'webview') {
            var accountData = event.data.accountData;
            if (accountData && accountData.userId && accountData.token) {
                var fs = require('fs');
                var path = require('path');
                var electron = require('electron');
                var dataPath = path.join(electron.remote.app.getPath('userData'), 'accounts.json');
                var data = { accounts: [], lastUser: null };
                try {
                    if (fs.existsSync(dataPath)) {
                        data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
                    }
                } catch (e) {}

                var accounts = data.accounts || [];
                var existing = accounts.findIndex(function(a) { return a.userId === accountData.userId; });
                var account = {
                    username: accountData.username,
                    userId: accountData.userId,
                    token: accountData.token,
                    tokenVersion: accountData.tokenVersion,
                    avatarUrl: accountData.avatarUrl || null,
                    lastLogin: new Date().toISOString()
                };

                if (existing >= 0) {
                    accounts[existing] = account;
                } else {
                    accounts.push(account);
                }

                data.accounts = accounts;
                data.lastUser = account;
                fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
            }
        }
    });

    if (window.electronAPI && window.electronAPI.onSoundsDownloadProgress) {
        window.electronAPI.onSoundsDownloadProgress(function(progress) {
            if (soundsPanelContent && soundsPanelContent.querySelector('.sounds-loading')) {
                soundsPanelContent.innerHTML = '<div class="sounds-loading">Загрузка: ' + progress.current + '/' + progress.total + ' (' + progress.sound + ')</div>';
            }
        });
    }

    window.electronAPI.onProgress(function(name, progress) {
        updateAddonProgress(name, progress);
    });

    // ✅ Обновлённый обработчик: ждём 3 секунды после успешной установки
    window.electronAPI.onOperationFinished(function(name, success) {
        if (success) {
            setTimeout(function() {
                refreshAddonStatus(name);
            }, 500);
        }
    });

    window.electronAPI.onAddonUpdateAvailable(function(name) {
        if (name === 'NSQC') refreshAddonStatus(name);
    });

    // ✅ Обновлённый обработчик: сброс флага установки при ошибке
    window.electronAPI.onError(function(error) {
        showError(error);
        var checkboxes = document.querySelectorAll('.addon-card input[type="checkbox"]');
        for (var i = 0; i < checkboxes.length; i++) {
            checkboxes[i].disabled = false;
        }
        isAddonInstalling = false;
        updateLaunchButtonState();
    });

    if (window.electronAPI && window.electronAPI.onKeyCaptured) {
        window.electronAPI.onKeyCaptured(function(code) {
            if (isMouseInCaptureZone) {
                capturedHotkey.add(code);
                pttCaptureArea.textContent = Array.from(capturedHotkey).join(' + ');
            }
        });
    }

    if (window.electronAPI && window.electronAPI.onPTTPressed) {
        window.electronAPI.onPTTPressed(function() {
            if (!isPanelMicActive) {
                isPanelMicActive = true;
                if (panelMicBtn) {
                    panelMicBtn.classList.add('active');
                    panelMicBtn.title = 'Микрофон активен (PTT)';
                }
                if (window.electronAPI) {
                    window.electronAPI.sendToWebClient('toggle-mic', { active: true });
                }
            }
        });
    }

    if (window.electronAPI && window.electronAPI.onPTTReleased) {
        window.electronAPI.onPTTReleased(function() {
            if (isPanelMicActive) {
                isPanelMicActive = false;
                if (panelMicBtn) {
                    panelMicBtn.classList.remove('active');
                    panelMicBtn.title = 'Активировать микрофон';
                }
                if (window.electronAPI) {
                    window.electronAPI.sendToWebClient('toggle-mic', { active: false });
                }
            }
        });
    }

    if (window.electronAPI && window.electronAPI.onWebClientEvent) {
        window.electronAPI.onWebClientEvent('mic-state', function(state) {
            if (voiceBtn) {
                voiceBtn.classList.toggle('speaking', state && state.speaking);
                voiceBtn.classList.toggle('muted', state && state.muted);
                voiceBtn.title = (state && state.muted) ? 'Микрофон выключен' : (state && state.speaking) ? 'Говорите...' : 'Микрофон готов';
            }
            if (panelMicBtn) {
                var active = (state && state.active) || (state && state.speaking) || false;
                if (!isPanelMicActive || active !== isPanelMicActive) {
                    isPanelMicActive = active;
                    panelMicBtn.classList.toggle('active', isPanelMicActive);
                }
            }
            if (window.electronAPI) {
                window.electronAPI.sendMicState(state);
            }
        });

        window.electronAPI.onWebClientEvent('request-ptt-register', function(config) {
            if (window.electronAPI && window.electronAPI.registerPTTHotkey && config && config.hotkey) {
                window.electronAPI.registerPTTHotkey(config.hotkey)
                    .then(function(result) {
                        window.electronAPI.sendToWebClient('ptt-register-result', result);
                    })
                    .catch(function() {});
            }
        });
    }

    if (nsWebview) {
        nsWebview.addEventListener('dom-ready', function() {
            if (window.electronAPI) {
                window.electronAPI.sendToWebClient('electron-config', { theme: 'dark', language: 'ru' });
            }
            var injectCode = '(function() { let ipcRenderer = null; try { if (typeof require !== "undefined") { ipcRenderer = require("electron").ipcRenderer; } } catch (e) {} if (!ipcRenderer && window.ipcRenderer) ipcRenderer = window.ipcRenderer; window.ELECTRON_CUSTOM_SOUNDS_ENABLED = true; window.electronAPI = { playSound: (soundType) => { if (ipcRenderer) { try { ipcRenderer.sendToHost("play-sound", soundType); return Promise.resolve(true); } catch (e) {} } window.postMessage({ type: "ELECTRON_PLAY_SOUND", soundType: soundType, source: "webview" }, "*"); return Promise.resolve(true); }, showNotification: (title, body) => { window.postMessage({ type: "ELECTRON_SHOW_NOTIFICATION", title: title, body: body, source: "webview" }, "*"); }, updateTrayBadge: (count) => { window.postMessage({ type: "ELECTRON_UPDATE_TRAY_BADGE", count: count, source: "webview" }, "*"); }, saveAccount: (accountData) => { window.postMessage({ type: "ELECTRON_SAVE_ACCOUNT", accountData: accountData, source: "webview" }, "*"); } }; window.addEventListener("message", (event) => { if (event.data && event.data.type === "ELECTRON_PLAY_SOUND" && event.data.soundType) {} }); })();';
            nsWebview.executeJavaScript(injectCode).catch(function() {});
        });

        nsWebview.addEventListener('did-fail-load', function(event) {
            showError('Не удалось загрузить веб-клиент: ' + (event.errorDescription || 'Unknown error'));
        });

        nsWebview.addEventListener('ipc-message', function(event) {
            if (event.channel === 'play-sound') {
                var soundType = event.args[0];
                window.electronAPI.playSound(soundType).catch(function() {});
            }
        });

        nsWebview.addEventListener('console-message', function(event) {
            var message = event.message;
            var match;
            var text;
            var soundType;

            if (message.startsWith('ELECTRON_NOTIFICATION:')) {
                try {
                    var jsonStr = message.substring('ELECTRON_NOTIFICATION:'.length);
                    var data = JSON.parse(jsonStr);
                    console.log('[NOTIFICATION] Received from webview:', data.title, data.body);
                    if (window.electronAPI && window.electronAPI.showNotification) {
                        window.electronAPI.showNotification(data.title, data.body);
                    }
                } catch (e) {
                    console.error('[NOTIFICATION] Parse error:', e);
                }
            }

            if (message.indexOf('[CHAT] Sending to overlay:') !== -1) {
                match = message.match(/Sending to overlay:\s*(.+)$/);
                if (match) {
                    text = match[1].trim();
                    console.log('[CHAT] Captured:', text);
                    if (window.electronAPI && window.electronAPI.sendMessageToOverlay) {
                        window.electronAPI.sendMessageToOverlay(text).catch(function(err) {
                            console.error('[OVERLAY] Failed:', err);
                        });
                    }
                }
            }

            if (message.indexOf('playSound called with:') !== -1 && message.indexOf('[CLIENT]') !== -1) {
                match = message.match(/playSound called with:\s*(\w+-\w+|\w+)/);
                if (match) {
                    soundType = match[1];
                }
            }

            if (soundType) {
                window.electronAPI.playSound(soundType).catch(function() {});
            }
        });
    }

    window.addEventListener('message', function(event) {
        if (event.data && event.data.type === 'COPY_TO_CLIPBOARD' && event.data.text) {
            if (window.electronAPI && window.electronAPI.copyToClipboard) {
                window.electronAPI.copyToClipboard(event.data.text).catch(function() {});
            }
        }
    });
});