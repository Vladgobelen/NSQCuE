import UIManager from './UIManager.js';

class TextChatManager {
    static setupSocketHandlers(client) {
        if (!client.socket) return;

        client.socket.on('new-message', (message) => {
            console.log('New message received:', message);
            if (message.roomId === client.currentRoom) {
                // ✅ Передаём messageId и readBy
                UIManager.addMessage(
                    message.username,
                    message.text,
                    message.timestamp,
                    message.type,
                    message.imageUrl,
                    message.id,               // messageId
                    message.readBy || []      // readBy
                );
            }
        });

        client.socket.on('text-message-history', (data) => {
            console.log('Message history received:', data);
            if (data.roomId === client.currentRoom && data.messages) {
                UIManager.clearMessages();
                data.messages.forEach(msg => {
                    // ✅ Передаём messageId и readBy
                    UIManager.addMessage(
                        msg.username,
                        msg.text,
                        msg.timestamp,
                        msg.type,
                        msg.imageUrl,
                        msg.id,                   // messageId
                        msg.readBy || []          // readBy
                    );
                });
            }
        });

        client.socket.on('messages-read', (data) => {
            if (data.messageIds && Array.isArray(data.messageIds)) {
                data.messageIds.forEach(id => {
                    UIManager.updateMessageReadStatus(id, data.readerId, data.readerName);
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
                console.log('[TextChatManager.loadMessages] Raw response from server:', data);
                if (data.messages && Array.isArray(data.messages)) {
                    if (!before) {
                        UIManager.clearMessages();
                    }
                    data.messages.forEach(message => {
                        console.log('[TextChatManager] Processing message for UI:', {
                            id: message.id,
                            type: message.type,
                            imageUrl: message.imageUrl,
                            username: message.username
                        });
                        UIManager.addMessage(
                            message.username,
                            message.text,
                            message.timestamp,
                            message.type,
                            message.imageUrl,
                            message.id,
                            message.readBy || []
                        );
                    });
                }
            }
        } catch (error) {
            console.error('Error loading messages:', error);
        }
    }

    static async uploadImage(client, roomId, file) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            throw new Error('Поддерживаются только JPEG, PNG и WebP');
        }
        if (file.size > 5 * 1024 * 1024) {
            throw new Error('Файл слишком большой (макс. 5 МБ)');
        }

        const formData = new FormData();
        formData.append('image', file);

        const response = await fetch(`${client.API_SERVER_URL}/api/messages/upload-image/${roomId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${client.token}`
            },
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Ошибка загрузки изображения');
        }

        const result = await response.json();
        return result.imageUrl;
    }

    static async markMessagesAsRead(client, messageIds) {
        if (!client.currentRoom || !Array.isArray(messageIds) || messageIds.length === 0) return;
        try {
            const response = await fetch(`${client.API_SERVER_URL}/api/messages/${client.currentRoom}/read`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${client.token}`
                },
                body: JSON.stringify({ messageIds })
            });
            if (!response.ok) {
                console.warn('Failed to mark messages as read');
            }
        } catch (error) {
            console.error('Error marking messages as read:', error);
        }
    }

    static async sendMessage(client, content, type = 'text') {
        if (!client.currentRoom) return;

        let payload;
        if (type === 'text') {
            if (!content?.trim()) return;
            payload = {
                roomId: client.currentRoom,
                type: 'text',
                text: content.trim()
            };
        } else if (type === 'image') {
            if (!content) throw new Error('imageUrl required for image message');
            payload = {
                roomId: client.currentRoom,
                type: 'image',
                imageUrl: content
            };
        } else {
            throw new Error('Unsupported message type');
        }

        try {
            const response = await fetch(`${client.API_SERVER_URL}/api/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${client.token}`
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Ошибка отправки сообщения');
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
