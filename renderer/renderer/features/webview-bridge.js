import { dom } from '../core/dom.js';
import { ipc } from '../core/ipc.js';
import { showError } from '../core/utils.js';
import { sendMessageToWebChat } from './voice.js';

const INJECT_CODE = `
  (function() {
    if (window.__nsqcueInjected) {
      console.log('[RENDERER-INJECT] already injected, skip');
      return;
    }
    window.__nsqcueInjected = true;
    console.log('[RENDERER-INJECT] starting');

    window.ELECTRON_CUSTOM_SOUNDS_ENABLED = true;
    window.electronAPI = {
      playSound: (soundType) => {
        console.log('[RENDERER-INJECT][SOUND] playSound:', soundType);
        console.log('ELECTRON_SOUND:' + soundType);
        return Promise.resolve(true);
      },
      showNotification: (title, body) => {
        console.log('[RENDERER-INJECT][NOTIF] showNotification:', title, body);
        console.log('ELECTRON_NOTIFICATION:' + JSON.stringify({ title, body }));
        window.postMessage({ type: 'ELECTRON_SHOW_NOTIFICATION', title, body, source: 'webview' }, '*');
      },
      updateTrayBadge: (count) => {
        console.log('[RENDERER-INJECT][TRAY] updateTrayBadge:', count);
        window.postMessage({ type: 'ELECTRON_UPDATE_TRAY_BADGE', count, source: 'webview' }, '*');
      },
      saveAccount: (accountData) => {
        console.log('[RENDERER-INJECT][ACC] saveAccount:', accountData && accountData.username);
        window.postMessage({ type: 'ELECTRON_SAVE_ACCOUNT', accountData, source: 'webview' }, '*');
      },
    };
    console.log('[RENDERER-INJECT] electronAPI installed');
  })();
`;

export function bindWebviewEvents() {
  if (!dom.nsWebview) {
    console.warn('[BRIDGE] nsWebview not found, skip');
    return;
  }

  dom.nsWebview.addEventListener('dom-ready', () => {
    console.log('[BRIDGE] webview dom-ready');
    ipc.sendToWebClient('electron-config', { theme: 'dark', language: 'ru' })
      .then(() => console.log('[BRIDGE] electron-config sent'))
      .catch((e) => console.error('[BRIDGE] electron-config FAIL:', e));
    dom.nsWebview.executeJavaScript(INJECT_CODE).catch((e) => {
      console.error('[BRIDGE] inject FAIL:', e);
    });
  });

  dom.nsWebview.addEventListener('did-fail-load', (event) => {
    console.error('[BRIDGE] did-fail-load:', event.errorDescription, event.errorCode);
    showError('Не удалось загрузить веб-клиент: ' + (event.errorDescription || 'Unknown error'));
  });

  dom.nsWebview.addEventListener('ipc-message', (event) => {
    console.log('[BRIDGE] ipc-message:', event.channel, event.args);
    if (event.channel === 'play-sound') {
      const soundType = event.args[0];
      ipc.playSound?.(soundType)?.catch?.(() => {});
    }
  });

  dom.nsWebview.addEventListener('console-message', (event) => {
    const message = event.message;
    if (!message) return;

    if (message.startsWith('[INJECT]') || message.startsWith('[RENDERER-INJECT]') || message.startsWith('[INJECT-FAIL]')) {
      console.log('[WEBVIEW-LOG]', message);
      return;
    }

    if (message.startsWith('ELECTRON_NOTIFICATION:')) {
      try {
        const data = JSON.parse(message.substring('ELECTRON_NOTIFICATION:'.length));
        console.log('[BRIDGE] notification:', data.title, data.body);
        ipc.showNotification(data.title, data.body);
      } catch (e) {
        console.error('[BRIDGE] notification parse FAIL:', e);
      }
      return;
    }

    if (message.indexOf('[CHAT] Sending to overlay:') !== -1) {
      const m = message.match(/Sending to overlay:\s*(.+)$/);
      if (m) {
        const text = m[1].trim();
        console.log('[BRIDGE] CHAT (console) → overlay:', text);
        ipc.sendMessageToOverlay(text).catch((e) => {
          console.error('[BRIDGE] sendMessageToOverlay FAIL:', e);
        });
      }
    }
  });

  console.log('[BRIDGE] webview handlers bound');
}

export function bindGlobalMessages() {
  window.addEventListener('message', (event) => {
    if (!event.data) return;
    const d = event.data;

    if (d.type === 'SAVE_CREDENTIALS' && d.source === 'webview') {
      console.log('[BRIDGE] SAVE_CREDENTIALS');
      if (d.username && d.password) {
        ipc.saveCredentials(d.username, d.password).catch((e) => {
          console.error('[BRIDGE] saveCredentials FAIL:', e);
        });
      }
    } else if (d.type === 'CHAT_MESSAGE' && d.source === 'webview') {
      console.log('[BRIDGE] CHAT_MESSAGE → overlay:', d.text);
      ipc.sendMessageToOverlay(d.text).catch((e) => {
        console.error('[BRIDGE] sendMessageToOverlay FAIL:', e);
      });
    } else if (d.type === 'ELECTRON_SHOW_NOTIFICATION' && d.source === 'webview') {
      console.log('[BRIDGE] ELECTRON_SHOW_NOTIFICATION:', d.title, d.body);
      ipc.showNotification(d.title, d.body);
    } else if (d.type === 'ELECTRON_UPDATE_TRAY_BADGE' && d.source === 'webview') {
      console.log('[BRIDGE] ELECTRON_UPDATE_TRAY_BADGE:', d.count);
      ipc.updateTrayBadge(d.count);
    } else if (d.type === 'ELECTRON_SAVE_ACCOUNT' && d.source === 'webview') {
      console.log('[BRIDGE] ELECTRON_SAVE_ACCOUNT:', d.accountData && d.accountData.username);
    } else if (d.type === 'COPY_TO_CLIPBOARD' && d.text) {
      ipc.copyToClipboard(d.text).catch(() => {});
    }
  });
  console.log('[BRIDGE] global message handler bound');
}

export function bindOverlayInput() {
  ipc.onOverlayInput((text) => {
    console.log('[BRIDGE] overlay-input → chat:', text);
    sendMessageToWebChat(text);
  });
  console.log('[BRIDGE] overlay-input handler bound');
}