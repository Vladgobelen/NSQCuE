import { dom } from '../core/dom.js';
import { ipc } from '../core/ipc.js';
import { uiState } from '../core/state.js';
import { formatHotkey } from '../core/utils.js';
import { escapeJsString } from '../core/utils.js';

function applyViewVisibility() {
  if (uiState.isWebViewVisible) {
    dom.webviewContainer.classList.add('active');
    dom.topBar.style.display = 'none';
    dom.gamePanel.style.display = 'none';
    dom.divider.style.display = 'none';
    dom.addonsHeader.style.display = 'none';
    dom.addonsList.style.display = 'none';
    dom.backPanel.style.display = 'flex';
    dom.voiceBtn.style.display = 'none';
  } else {
    dom.webviewContainer.classList.remove('active');
    dom.topBar.style.display = 'flex';
    dom.gamePanel.style.display = 'flex';
    dom.divider.style.display = 'block';
    dom.addonsHeader.style.display = 'flex';
    dom.addonsList.style.display = 'block';
    dom.backPanel.style.display = 'none';
    dom.backPanel.classList.remove('visible');
    dom.voiceBtn.style.display = 'block';
  }
}

export async function toggleView(show) {
  uiState.isWebViewVisible = show;
  applyViewVisibility();

  if (show) {
    try {
      const platform = await ipc.getPlatform();
      ipc.sendToWebClient('electron-ready', {
        version: '1.0.0',
        platform: platform || 'unknown',
        userAgent: navigator.userAgent,
      });
    } catch {
      ipc.sendToWebClient('electron-ready', {
        version: '1.0.0',
        platform: 'unknown',
        userAgent: navigator.userAgent,
      });
    }

    setTimeout(async () => {
      try {
        const creds = await ipc.loadCredentials();
        if (creds && creds.username && creds.password) {
          const u = escapeJsString(creds.username);
          const p = escapeJsString(creds.password);
          const code = `(function() { var u = document.querySelector("#usernameInput, input[name=\\"username\\"], input[placeholder*=\\"Ник\\"]"); var p = document.querySelector("#passwordInput, input[type=\\"password\\"]"); if (u && p) { u.value = "${u}"; p.value = "${p}"; var b = document.querySelector("#authSubmitBtn, button:contains('Войти')"); if (b) b.click(); } })();`;
          dom.nsWebview.executeJavaScript(code).catch(() => {});
        }
      } catch {}
    }, 2000);
  } else {
    ipc.updateTrayBadge(0);
  }
}

export function bindVoiceEvents() {
  dom.voiceBtn.addEventListener('click', () => toggleView(true));
  dom.backBtn.addEventListener('click', () => toggleView(false));
}

// Экспорт для panel.js/accounts.js (утилита)
export function sendMessageToWebChat(text) {
  if (!dom.nsWebview) return;
  const escaped = escapeJsString(text);
  const code = `(function() { var s = ["input[type=\\"text\\"]", "textarea", "[contenteditable=\\"true\\"]", ".chat-input", "#chat-input", ".message-input"]; var i = null; for (var j = 0; j < s.length; j++) { i = document.querySelector(s[j]); if (i) break; } if (i && (i.tagName === "INPUT" || i.tagName === "TEXTAREA")) { i.value = "${escaped}"; i.dispatchEvent(new Event("input", { bubbles: true })); var b = document.querySelector("button[type=\\"submit\\"], .send-button, #send-button"); if (b) { b.click(); } else { i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true })); } return true; } return false; })();`;
  dom.nsWebview.executeJavaScript(code).catch((err) => {
    console.error('[OVERLAY] Error sending to web chat:', err);
  });
}