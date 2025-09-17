import UIManager from './UIManager.js';

class TextChatManager {
    static setupSocketHandlers(client) {
        if (!client.socket) return;

        client.socket.on('new-message', (message) => {
            console.log('New message received:', message);
            if (message.roomId === client.currentRoom) {
                UIManager.addMessage(message.username, message.text, message.timestamp);
            }
        });

        client.socket.on('text-message-history', (data) => {
            console.log('Message history received:', data);
            if (data.roomId === client.currentRoom && data.messages) {
                UIManager.clearMessages();
                
                data.messages.forEach(msg => {
                    UIManager.addMessage(msg.username, msg.text, msg.timestamp);
                });
            }
        });

        client.socket.on('connect', () => {
            console.log('Socket connected');
            UIManager.updateStatus('Подключено', 'connected');
            
            if (client.currentRoom) {
                this.joinTextRoom(client, client.currentRoom);
            }
        });

        client.socket.on('disconnect', (reason) => {
            console.log('Socket disconnected:', reason);
            UIManager.updateStatus('Отключено', 'disconnected');
        });
    }

    static joinTextRoom(client, roomId) {
        if (client.socket) {
            client.socket.emit('join-text-room', { roomId });
        }
    }

    static leaveTextRoom(client, roomId) {
        if (client.socket) {
            client.socket.emit('leave-text-room', { roomId });
        }
    }

    static async loadMoreMessages(client, roomId, beforeMessageId) {
        return this.loadMessages(client, roomId, 50, beforeMessageId);
    }

    static async loadMessages(client, roomId, limit = 100, before = null) {
        try {
            const params = new URLSearchParams();
            params.append('limit', limit);
            if (before) params.append('before', before);
            
            const response = await fetch(`${client.API_SERVER_URL}/api/chat/rooms/${roomId}/messages?${params}`, {
                headers: {
                    'Authorization': `Bearer ${client.token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                if (data.messages && Array.isArray(data.messages)) {
                    if (!before) {
                        UIManager.clearMessages();
                    }
                    
                    data.messages.forEach(message => {
                        UIManager.addMessage(message.username, message.text, message.timestamp);
                    });
                }
            }
        } catch (error) {
            console.error('Error loading messages:', error);
        }
    }

    static async sendMessage(client, text) {
        if (!text.trim() || !client.currentRoom) return;

        try {
            const response = await fetch(`${client.API_SERVER_URL}/api/chat/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${client.token}`
                },
                body: JSON.stringify({
                    roomId: client.currentRoom,
                    text: text.trim()
                })
            });

            if (!response.ok) {
                throw new Error('Ошибка отправки сообщения');
            }
            
            const data = await response.json();
            return data.message;
        } catch (error) {
            UIManager.showError('Не удалось отправить сообщение');
            throw error;
        }
    }
}

export default TextChatManager;
