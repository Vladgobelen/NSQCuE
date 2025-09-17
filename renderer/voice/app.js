// renderer/voice/app.js

// Импортируем все классы
import VoiceChatClient from './modules/VoiceChatClient.js';
import AuthManager from './modules/AuthManager.js';

// Ждем полной загрузки DOM, чтобы все элементы были доступны для UIManager
document.addEventListener('DOMContentLoaded', () => {
    console.log('Voice Chat App: DOM fully loaded and parsed');
    // Создаем экземпляр клиента
    window.client = new VoiceChatClient();
});

// Добавляем глобальную функцию для возврата назад
window.goBackToMain = () => {
    window.electronAPI.goBack();
};