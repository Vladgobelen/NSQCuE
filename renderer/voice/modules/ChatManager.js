import UIManager from './UIManager.js';

class ChatManager {
    static async loadMessages(client, roomId) {
        try {
            const response = await fetch(`${client.API_SERVER_URL}/api/rooms/${roomId}/messages`, {
                headers: {
                    'Authorization': `Bearer ${client.token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                if (data.messages && Array.isArray(data.messages)) {
                    data.messages.forEach(message => {
                        const username = message.username || 'Unknown';
                        UIManager.addMessage(username, message.text, message.timestamp);
                    });
                }
            }
        } catch (error) {}
    }

    static async sendMessage(client, text) {
        if (!text.trim() || !client.currentRoom) return;

        try {
            const response = await fetch(`${client.API_SERVER_URL}/api/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${client.token}`
                },
                body: JSON.stringify({
                    roomId: client.currentRoom,
                    text: text.trim(),
                    userId: client.userId
                })
            });

            if (!response.ok) {
                throw new Error('Ошибка отправки сообщения');
            }
        } catch (error) {
            UIManager.showError('Не удалось отправить сообщение');
        }
    }

    static setupSocketHandlers(client) {
        if (!client.socket) return;

        client.socket.on('new-message', (data) => {
            const username = data.username || 'Unknown';
            UIManager.addMessage(username, data.text, data.timestamp);
        });

        client.socket.on('message-history', (messages) => {
            messages.forEach(msg => {
                const username = msg.username || 'Unknown';
                UIManager.addMessage(username, msg.text, msg.timestamp);
            });
        });
    }
}

export default ChatManager;
