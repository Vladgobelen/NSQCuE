import { dom } from '../core/dom.js';
import { uiState } from '../core/state.js';

// Управление окном аккаунтов. Работает напрямую с localStorage webview через executeJavaScript.
export function showAccountsModal() {
  if (!dom.nsWebview) {
    alert('Веб-клиент не загружен');
    return;
  }

  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:100000;';
  modal.innerHTML = '<div style="background:#252525;border:1px solid #555;border-radius:10px;padding:20px;min-width:300px;max-width:400px;"><h3 style="color:white;margin-bottom:15px;text-align:center;">Аккаунты</h3><div id="accounts-list-container" style="max-height:300px;overflow-y:auto;"><div style="color:#aaa;text-align:center;padding:20px;">Загрузка...</div></div><div style="margin-top:15px;display:flex;gap:10px;justify-content:space-between;"><button id="add-account-btn" style="padding:8px 16px;background:#2a82da;border:none;border-radius:5px;color:white;cursor:pointer;">➕ Добавить</button><button id="close-modal-btn" style="padding:8px 16px;background:#3d3d3d;border:1px solid #555;border-radius:5px;color:white;cursor:pointer;">Закрыть</button></div></div>';
  document.body.appendChild(modal);

  const accountsContainer = document.getElementById('accounts-list-container');
  modal.querySelector('#close-modal-btn').onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  modal.querySelector('#add-account-btn').onclick = () => {
    dom.nsWebview.executeJavaScript('(function() { localStorage.removeItem("voicechat_lastuser"); location.reload(); })();');
    modal.remove();
  };

  dom.nsWebview.executeJavaScript(`
    (function() {
      var accounts = JSON.parse(localStorage.getItem('voicechat_accounts') || '[]');
      var current = JSON.parse(localStorage.getItem('voicechat_lastuser') || 'null');
      return { accounts: accounts, current: current };
    })();
  `).then((result) => {
    const accounts = result.accounts || [];
    const current = result.current;
    let html = '';

    for (const acc of accounts) {
      const isCurrent = current && acc.userId === current.userId;
      html += `<div class="account-item" data-userid="${acc.userId}" style="padding:10px;margin:5px 0;background:${isCurrent ? '#2a82da' : '#3d3d3d'};border-radius:5px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;"><span style="color:white;">${acc.username}${isCurrent ? ' ✓' : ''}</span><button class="delete-account" data-userid="${acc.userId}" style="background:none;border:none;color:#f44336;cursor:pointer;font-size:16px;">✕</button></div>`;
    }
    accountsContainer.innerHTML = html || '<div style="color:#aaa;text-align:center;padding:20px;">Нет сохранённых аккаунтов</div>';

    const items = accountsContainer.querySelectorAll('.account-item');
    for (const item of items) {
      item.onclick = (e) => {
        if (e.target.classList.contains('delete-account')) return;
        const acc = accounts.find((a) => a.userId === item.dataset.userid);
        if (!acc || (current && acc.userId === current.userId)) return;
        dom.nsWebview.executeJavaScript(`(function() { localStorage.setItem("voicechat_lastuser", JSON.stringify(${JSON.stringify(acc)})); location.reload(); })();`);
        modal.remove();
      };
    }

    const deleteButtons = accountsContainer.querySelectorAll('.delete-account');
    for (const btn of deleteButtons) {
      btn.onclick = (e) => {
        e.stopPropagation();
        const newAccounts = accounts.filter((a) => a.userId !== btn.dataset.userid);
        dom.nsWebview.executeJavaScript(`(function() { localStorage.setItem("voicechat_accounts", JSON.stringify(${JSON.stringify(newAccounts)})); })();`);
        modal.remove();
        showAccountsModal();
      };
    }
  }).catch(() => {
    accountsContainer.innerHTML = '<div style="color:#f44336;text-align:center;padding:20px;">Ошибка загрузки аккаунтов</div>';
  });
}