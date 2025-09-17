import UIManager from './UIManager.js';

class UserPresenceManager {
    static PRESENCE_UPDATE_INTERVAL = 30000; // 30 секунд
    static INACTIVITY_TIMEOUT = 300000; // 5 минут

    static init(client) {
        this.client = client;
        this.lastActivityTime = Date.now();
        this.setupActivityTracking();
        this.startPresenceUpdates();
    }

    static setupActivityTracking() {
        // Отслеживаем активность пользователя
        const activityEvents = [
            'mousedown', 'mousemove', 'keypress', 
            'scroll', 'touchstart', 'click',
            'message', 'mic-state-change'
        ];

        activityEvents.forEach(event => {
            document.addEventListener(event, () => {
                this.updateLastActivity();
            }, { passive: true });
        });

        // Также отслеживаем активность в чате
        const originalAddMessage = UIManager.addMessage;
        UIManager.addMessage = function(...args) {
            originalAddMessage.apply(this, args);
            UserPresenceManager.updateLastActivity();
        };
    }

    static updateLastActivity() {
        this.lastActivityTime = Date.now();
        
        // Если пользователь стал активным после периода неактивности
        if (!this.isUserActive && this.client.userId) {
            this.setUserActive(true);
        }
    }

    static async setUserActive(isActive) {
        if (!this.client.userId || !this.client.token) return;

        this.isUserActive = isActive;

        try {
            // Используем существующий эндпоинт для обновления присутствия
            const response = await fetch(`${this.client.API_SERVER_URL}/api/presence/update`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.client.token}`
                },
                body: JSON.stringify({
                    isOnline: isActive,
                    currentRoom: this.client.currentRoom,
                    lastActivity: new Date().toISOString()
                })
            });

            if (!response.ok) {
                throw new Error('Ошибка обновления статуса');
            }
        } catch (error) {
            console.error('Ошибка обновления статуса присутствия:', error);
        }
    }

    static startPresenceUpdates() {
        // Периодически обновляем статус присутствия
        this.presenceInterval = setInterval(() => {
            this.checkActivity();
            this.updatePresence();
        }, this.PRESENCE_UPDATE_INTERVAL);

        // Также обновляем статус при изменении комнаты
        const originalJoinRoom = this.client.joinRoom;
        this.client.joinRoom = async (...args) => {
            const result = await originalJoinRoom.apply(this.client, args);
            if (result) {
                this.updatePresence();
            }
            return result;
        };

        const originalLeaveRoom = this.client.leaveRoom;
        this.client.leaveRoom = async (...args) => {
            const result = await originalLeaveRoom.apply(this.client, args);
            if (result) {
                this.updatePresence();
            }
            return result;
        };
    }

    static checkActivity() {
        const currentTime = Date.now();
        const inactiveTime = currentTime - this.lastActivityTime;

        // Если пользователь неактивен дольше таймаута
        if (inactiveTime > this.INACTIVITY_TIMEOUT && this.isUserActive) {
            this.setUserActive(false);
        }
        // Если пользователь снова активен после неактивности
        else if (inactiveTime <= this.INACTIVITY_TIMEOUT && !this.isUserActive) {
            this.setUserActive(true);
        }
    }

    static async updatePresence() {
        if (!this.client.userId || !this.client.token) return;

        try {
            const response = await fetch(`${this.client.API_SERVER_URL}/api/presence/update`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.client.token}`
                },
                body: JSON.stringify({
                    currentRoom: this.client.currentRoom,
                    isMicActive: this.client.isMicActive,
                    lastActivity: new Date().toISOString()
                })
            });

            if (!response.ok) {
                throw new Error('Ошибка обновления присутствия');
            }
        } catch (error) {
            console.error('Ошибка обновления присутствия:', error);
        }
    }

    static async getOnlineUsers(roomId = null) {
        if (!this.client.token) return [];

        try {
            let url = `${this.client.API_SERVER_URL}/api/presence/online-users`;
            if (roomId) {
                url += `?roomId=${roomId}`;
            }

            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${this.client.token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error('Ошибка получения онлайн пользователей');
            }

            const data = await response.json();
            return data.users || [];
        } catch (error) {
            console.error('Ошибка получения онлайн пользователей:', error);
            return [];
        }
    }

    static async getUserPresence(userId) {
        if (!this.client.token) return { isOnline: false, lastSeen: null };

        try {
            const response = await fetch(`${this.client.API_SERVER_URL}/api/presence/user/${userId}`, {
                headers: {
                    'Authorization': `Bearer ${this.client.token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error('Ошибка получения статуса пользователя');
            }

            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Ошибка получения статуса пользователя:', error);
            return { isOnline: false, lastSeen: null };
        }
    }

    static async subscribeToPresenceUpdates(roomId) {
        if (!this.client.socket || !roomId) return;

        // Подписываемся на обновления присутствия через сокет
        this.client.socket.emit('subscribe-presence', { roomId });

        this.client.socket.on('presence-update', (data) => {
            this.handlePresenceUpdate(data);
        });

        this.client.socket.on('user-joined', (data) => {
            this.handleUserJoined(data);
        });

        this.client.socket.on('user-left', (data) => {
            this.handleUserLeft(data);
        });
    }

    static handlePresenceUpdate(data) {
        // Обрабатываем обновление статуса пользователя
        const { userId, isOnline, isMicActive, lastSeen } = data;
        
        // Обновляем UI
        UIManager.updateUserPresence(userId, {
            isOnline,
            isMicActive,
            lastSeen: lastSeen ? new Date(lastSeen) : null
        });
    }

    static handleUserJoined(data) {
        // Обрабатываем присоединение пользователя
        const { userId, username, isMicActive } = data;
        
        // Добавляем пользователя в UI
        UIManager.addUser({
            userId,
            username,
            isMicActive: isMicActive || false,
            isOnline: true
        });

        // Показываем системное сообщение
        UIManager.addMessage('System', `Пользователь ${username} присоединился`, new Date().toISOString());
    }

    static handleUserLeft(data) {
        // Обрабатываем выход пользователя
        const { userId, username } = data;
        
        // Обновляем статус пользователя в UI
        UIManager.updateUserPresence(userId, {
            isOnline: false,
            isMicActive: false,
            lastSeen: new Date().toISOString()
        });

        // Показываем системное сообщение
        UIManager.addMessage('System', `Пользователь ${username} покинул чат`, new Date().toISOString());
    }

    static async updateMicState(isActive) {
        if (!this.client.userId || !this.client.token) return;

        this.client.isMicActive = isActive;

        try {
            const response = await fetch(`${this.client.API_SERVER_URL}/api/presence/mic-state`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.client.token}`
                },
                body: JSON.stringify({
                    isActive: isActive,
                    roomId: this.client.currentRoom
                })
            });

            if (!response.ok) {
                throw new Error('Ошибка обновления статуса микрофона');
            }

            // Также отправляем через сокет для мгновенного обновления
            if (this.client.socket && this.client.currentRoom) {
                this.client.socket.emit('mic-state-change', {
                    isActive: isActive,
                    roomId: this.client.currentRoom
                });
            }
        } catch (error) {
            console.error('Ошибка обновления статуса микрофона:', error);
        }
    }

    static cleanup() {
        if (this.presenceInterval) {
            clearInterval(this.presenceInterval);
        }

        // Устанавливаем статус оффлайн при выходе
        if (this.client.userId) {
            this.setUserActive(false);
        }
    }
}

export default UserPresenceManager;
