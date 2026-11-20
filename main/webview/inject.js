const LOCALSTORAGE_HOOK = `
(function() {
  if (window.__nsqcueLocalStorageHooked) return;
  window.__nsqcueLocalStorageHooked = true;
  console.log('[INJECT] localStorage hook installed');

  var originalSetItem = localStorage.setItem;
  localStorage.setItem = function(key, value) {
    originalSetItem.call(this, key, value);
    if (key === 'voicechat_lastuser' && value) {
      try {
        var accountData = JSON.parse(value);
        if (accountData && accountData.userId && accountData.token) {
          var accounts = JSON.parse(localStorage.getItem('voicechat_accounts') || '[]');
          var existing = accounts.findIndex(function(a) { return a.userId === accountData.userId; });
          var account = {
            username: accountData.username,
            userId: accountData.userId,
            token: accountData.token,
            tokenVersion: accountData.tokenVersion,
            avatarUrl: accountData.avatarUrl || null,
            lastLogin: new Date().toISOString()
          };
          if (existing >= 0) accounts[existing] = account;
          else accounts.push(account);
          localStorage.setItem('voicechat_accounts', JSON.stringify(accounts));
          console.log('[INJECT] account saved:', account.username);
        }
      } catch (e) {
        console.error('[INJECT] account parse error:', e);
      }
    }
  };
})();
`;

const ELECTRON_API = `
(function() {
  // ВАЖНО: свой флаг, отдельный от __nsqcueInjected.
  // Ранний минимальный inject из renderer (webview-bridge.js, dom-ready)
  // ставит __nsqcueInjected. Если проверять тот же флаг, этот полный
  // inject (did-finish-load) пропускался целиком, и наблюдатели
  // чата/уведомлений никогда не создавались — оверлей был пустым.
  if (window.__nsqcueMainInjected) {
    console.log('[INJECT] already injected (main), skip');
    return;
  }
  window.__nsqcueMainInjected = true;
  console.log('[INJECT] Starting full injection...');

  window.ELECTRON_CUSTOM_SOUNDS_ENABLED = true;

  window.electronAPI = {
    playSound: function(soundType) {
      console.log('[INJECT][SOUND] playSound:', soundType);
      console.log('ELECTRON_SOUND:' + soundType);
      return Promise.resolve(true);
    },
    showNotification: function(title, body) {
      console.log('[INJECT][NOTIF] showNotification:', title, body);
      console.log('ELECTRON_NOTIFICATION:' + JSON.stringify({ title: title, body: body }));
      window.postMessage({ type: 'ELECTRON_SHOW_NOTIFICATION', title: title, body: body, source: 'webview' }, '*');
    },
    updateTrayBadge: function(count) {
      console.log('[INJECT][TRAY] updateTrayBadge:', count);
      window.postMessage({ type: 'ELECTRON_UPDATE_TRAY_BADGE', count: count, source: 'webview' }, '*');
    },
    saveAccount: function(accountData) {
      console.log('[INJECT][ACC] saveAccount:', accountData && accountData.username);
      window.postMessage({ type: 'ELECTRON_SAVE_ACCOUNT', accountData: accountData, source: 'webview' }, '*');
    }
  };
  console.log('[INJECT] electronAPI installed (full)');

  // ── Уведомления ───────────────────────────────────────
  if (window.__notificationObserver) {
    window.__notificationObserver.disconnect();
    console.log('[INJECT][NOTIF] previous observer disconnected');
  }

  var pendingNotification = null;
  var notificationTimer = null;
  var lastProcessedId = null;
  var processingTimeout = null;

  function hookVoiceClient() {
    if (window.voiceClient && window.voiceClient.socket) {
      if (!window.voiceClient.socket.__originalOnevent) {
        window.voiceClient.socket.__originalOnevent = window.voiceClient.socket.onevent;
        console.log('[INJECT][HOOK] voiceClient.socket.onevent hooked');
      }
      window.voiceClient.socket.onevent = function(packet) {
        var event = packet.data[0];
        var data = packet.data[1];
        if (event === 'personal-notification') {
          console.log('[INJECT][NOTIF] personal-notification:', data);
          pendingNotification = {
            sender: data.sender || data.username || '',
            text: data.text || '',
            roomName: data.roomName || ''
          };
          if (notificationTimer) clearTimeout(notificationTimer);
          notificationTimer = setTimeout(function() { pendingNotification = null; }, 5000);
        }
        return window.voiceClient.socket.__originalOnevent.call(this, packet);
      };
      return true;
    }
    return false;
  }

  function tryHookVoiceClient(attempts) {
    attempts = attempts || 0;
    if (attempts > 30) {
      console.warn('[INJECT][HOOK] voiceClient hook failed after 30 attempts');
      return;
    }
    if (!hookVoiceClient()) {
      setTimeout(function() { tryHookVoiceClient(attempts + 1); }, 1000);
    }
  }

  function sendNotification(data) {
    var id = data.sender + '|' + data.text + '|' + data.roomName;
    if (lastProcessedId === id) {
      console.log('[INJECT][NOTIF] duplicate skipped:', id);
      return;
    }
    lastProcessedId = id;
    console.log('[INJECT][NOTIF] sendNotification:', data);
    console.log('ELECTRON_NOTIFICATION:' + JSON.stringify({ title: data.sender, body: data.text }));
    window.postMessage({ type: 'ELECTRON_SHOW_NOTIFICATION', title: data.sender, body: data.text, source: 'webview' }, '*');
    setTimeout(function() { lastProcessedId = null; }, 2000);
  }

  window.__notificationObserver = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var nodes = mutations[i].addedNodes;
      for (var j = 0; j < nodes.length; j++) {
        var node = nodes[j];
        if (node.id === 'live-notification-banner') {
          console.log('[INJECT][NOTIF] banner detected');
          if (processingTimeout) clearTimeout(processingTimeout);
          processingTimeout = setTimeout(function() {
            var strongEl = node.querySelector('strong');
            var domAuthor = strongEl && strongEl.textContent ? strongEl.textContent.trim() : '';
            if (pendingNotification) {
              sendNotification(pendingNotification);
              pendingNotification = null;
            } else {
              var spanEl = node.querySelector('span[style*="opacity"]');
              var domAction = spanEl && spanEl.textContent ? spanEl.textContent.trim() : '';
              if (domAuthor && domAction) {
                sendNotification({ sender: domAuthor, text: domAction, roomName: '' });
              }
            }
            if (notificationTimer) {
              clearTimeout(notificationTimer);
              notificationTimer = null;
            }
            processingTimeout = null;
          }, 100);
        }
      }
    }
  });

  window.__notificationObserver.observe(document.body, { childList: true, subtree: true });
  console.log('[INJECT][NOTIF] notificationObserver attached');

  // ── Чат → оверлей ─────────────────────────────────────
  if (window.__chatObserver) {
    window.__chatObserver.disconnect();
    console.log('[INJECT][CHAT] previous observer disconnected');
  }

  var CHAT_SELECTORS = ['.message', '.chat-message', '.msg', '[data-message]', '.chat-line', '.message-container'];
  var TEXT_SELECTORS = '.message-text, .text, .content, .message-content, .chat-text';
  var USER_SELECTORS = '.message-username, .username, .author, .sender, .nickname';

  function extractMessage(messageNode) {
    var textEl = messageNode.querySelector(TEXT_SELECTORS);
    var userEl = messageNode.querySelector(USER_SELECTORS);
    var text = textEl && textEl.textContent ? textEl.textContent.trim() : '';
    var username = userEl && userEl.textContent ? userEl.textContent.trim() : '';
    if (!text) {
      text = (messageNode.textContent || '').trim();
      if (text) console.log('[INJECT][CHAT] текст взят из textContent узла');
    }
    if (!text) return null;
    if (text === '🔴 Отключен' || text === '🟢 Подключен') {
      console.log('[INJECT][CHAT] статус подключения — пропуск');
      return null;
    }
    return { username: username, text: text };
  }

  window.__chatObserver = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var nodes = mutations[i].addedNodes;
      for (var j = 0; j < nodes.length; j++) {
        var node = nodes[j];
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        var messageNode = null;
        for (var k = 0; k < CHAT_SELECTORS.length; k++) {
          if (node.matches && node.matches(CHAT_SELECTORS[k])) {
            messageNode = node;
            break;
          }
          if (node.querySelector) {
            var child = node.querySelector(CHAT_SELECTORS[k]);
            if (child) {
              messageNode = child;
              break;
            }
          }
        }
        if (!messageNode) continue;
        var msg = extractMessage(messageNode);
        if (!msg) {
          console.log('[INJECT][CHAT] узел подошёл, но текст пуст — пропуск');
          continue;
        }
        var full = msg.username ? msg.username + ': ' + msg.text : msg.text;
        console.log('[INJECT][CHAT] captured:', full);
        console.log('[CHAT] Sending to overlay: ' + full);
        window.postMessage({ type: 'CHAT_MESSAGE', text: full, source: 'webview' }, '*');
      }
    }
  });

  window.__chatObserver.observe(document.body, { childList: true, subtree: true });
  console.log('[INJECT][CHAT] chatObserver attached, selectors:', CHAT_SELECTORS.join(', '));

  // ── Обратный канал: оверлей → чат ─────────────────────
  window.addEventListener('electron-message', function(e) {
    try {
      var detail = e.detail || {};
      console.log('[INJECT][EVENT] electron-message:', detail.channel, detail.payload);
      if (detail.channel === 'chat' && typeof detail.payload === 'string') {
        insertIntoChatInput(detail.payload);
      }
    } catch (err) {
      console.error('[INJECT][EVENT] error:', err);
    }
  });

  window.addEventListener('electron-mic-state', function(e) {
    console.log('[INJECT][MIC] state:', e.detail);
  });

  function insertIntoChatInput(text) {
    var input = document.querySelector('textarea.message-input')
      || document.querySelector('textarea')
      || document.querySelector('input[type="text"]')
      || document.querySelector('[contenteditable="true"]');
    if (!input) {
      console.warn('[INJECT][CHAT] input field not found');
      return false;
    }
    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      input.textContent = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    var sendBtn = document.querySelector('button.send-btn')
      || document.querySelector('button[type="submit"]')
      || document.querySelector('.send-button');
    if (sendBtn) {
      sendBtn.click();
    } else {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    }
    console.log('[INJECT][CHAT] inserted and sent:', text);
    return true;
  }

  tryHookVoiceClient();
  console.log('[INJECT] Ready!');
})();
`;

function injectIntoWebview(webContents) {
  const logger = require('../utils').setupLogging();
  console.log('[INJECT] injecting into webview');
  logger.info('[INJECT] injecting into webview');

  webContents.executeJavaScript(LOCALSTORAGE_HOOK).catch((err) => {
    console.error('[INJECT] localStorage hook failed:', err.message);
    logger.error(`[INJECT] localStorage hook failed: ${err.message}`);
  });

  webContents.executeJavaScript(ELECTRON_API).catch((err) => {
    console.error('[INJECT] electronAPI failed:', err.message);
    logger.error(`[INJECT] electronAPI failed: ${err.message}`);
  });
}

module.exports = { injectIntoWebview, ELECTRON_API, LOCALSTORAGE_HOOK };