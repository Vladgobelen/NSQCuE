import InviteManager from './InviteManager.js';

class AuthManager {
    static STORAGE_KEY = 'voicechat_users';
    static LAST_USER_KEY = 'voicechat_lastuser';

    static getAllUsers() {
        try {
            return JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || {};
        } catch {
            return {};
        }
    }

    static saveAllUsers(users) {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(users));
    }

    static loadLastUser() {
        try {
            return JSON.parse(localStorage.getItem(this.LAST_USER_KEY));
        } catch {
            return null;
        }
    }

    static saveLastUser(user) {
        localStorage.setItem(this.LAST_USER_KEY, JSON.stringify(user));
    }

    static removeUser(username) {
        const users = this.getAllUsers();
        delete users[username];
        this.saveAllUsers(users);
        
        const lastUser = this.loadLastUser();
        if (lastUser && lastUser.username === username) {
            localStorage.removeItem(this.LAST_USER_KEY);
        }
    }

    static async tryAutoLogin(client) {
        const lastUser = this.loadLastUser();
        if (!lastUser) return false;

        const isValid = await this.validateToken(client, lastUser.userId, lastUser.token);
        if (!isValid) {
            this.removeUser(lastUser.username);
            return false;
        }

        client.userId = lastUser.userId;
        client.token = lastUser.token;
        client.username = lastUser.username;
        
        // НОВОЕ: Инициализируем InviteManager после успешного авто-логина
        InviteManager.init(client);
        
        return true;
    }

    static async validateToken(client, userId, token) {
        try {
            const response = await fetch(`${client.API_SERVER_URL}/api/auth/validate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ userId, token })
            });

            if (!response.ok) return false;
            const data = await response.json();
            return data.valid === true;
        } catch (error) {
            return false;
        }
    }

    static async registerUser(client, username, password) {
        try {
            const response = await fetch(`${client.API_SERVER_URL}/api/auth`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const responseText = await response.text();
            let data;
            try {
                data = JSON.parse(responseText);
            } catch (e) {
                throw new Error('Сервер вернул неверный формат данных');
            }

            if (!response.ok) {
                throw new Error(data.error || `Ошибка сервера: ${response.status}`);
            }

            const users = this.getAllUsers();
            users[username] = {
                username: username,
                password: password,
                userId: data.userId,
                token: data.token
            };
            this.saveAllUsers(users);
            this.saveLastUser({
                username: username,
                userId: data.userId,
                token: data.token
            });

            client.userId = data.userId;
            client.token = data.token;
            client.username = username;

            // НОВОЕ: Инициализируем InviteManager после регистрации
            InviteManager.init(client);
            
            return true;
        } catch (error) {
            throw error;
        }
    }

    static showAuthModal(client) {
        const users = this.getAllUsers();
        const savedUser = this.loadLastUser();
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="modal-content">
                <h2>Выберите пользователя</h2>
                <div class="saved-users-list">
                    ${Object.keys(users).length === 0 
                        ? '<div class="no-users-message">Нет сохранённых пользователей</div>' 
                        : Object.values(users).map(u => `
                            <div class="saved-user-item" data-username="${u.username}">
                                <span>${u.username}</span>
                                <button class="remove-user-btn" data-user="${u.username}">✕</button>
                            </div>
                        `).join('')}
                </div>
                <input type="text" id="usernameInput" placeholder="Никнейм" value="${savedUser ? savedUser.username : ''}">
                <input type="password" id="passwordInput" placeholder="Пароль">
                <button id="authSubmitBtn">Войти</button>
                <button id="createNewUserBtn">➕ Создать нового</button>
            </div>
        `;
        document.body.appendChild(modal);
        
        const usernameInput = modal.querySelector('#usernameInput');
        const passwordInput = modal.querySelector('#passwordInput');
        const submitBtn = modal.querySelector('#authSubmitBtn');

        modal.querySelectorAll('.saved-user-item').forEach(item => {
            item.addEventListener('click', () => {
                const username = item.dataset.username;
                const user = users[username];
                usernameInput.value = username;
                passwordInput.value = user.password;
                passwordInput.focus();
            });
        });

        modal.querySelectorAll('.remove-user-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const username = btn.dataset.user;
                if (confirm(`Удалить пользователя ${username}?`)) {
                    this.removeUser(username);
                    modal.remove();
                    this.showAuthModal(client);
                }
            });
        });

        modal.querySelector('#createNewUserBtn').addEventListener('click', () => {
            usernameInput.value = '';
            passwordInput.value = '';
            usernameInput.focus();
        });

        const handleSubmit = async () => {
            const u = usernameInput.value.trim();
            const p = passwordInput.value.trim();
            if (u.length < 3 || p.length < 4) {
                alert('Ник — от 3, пароль — от 4');
                return;
            }
            try {
                const success = await this.registerUser(client, u, p);
                if (success) {
                    modal.remove();
                    
                    // НОВОЕ: Загружаем серверы через импорт
                    await import('./ServerManager.js').then(module => {
                        return module.default.loadServers(client);
                    });

                    // НОВОЕ: Применяем отложенный инвайт после авторизации
                    const inviteApplied = await InviteManager.applyPendingInvite();
                    
                    // Если инвайт был применен, он сам позаботится о навигации
                    if (inviteApplied) {
                        client.startSyncInterval();
                        return;
                    }

                    // Старая логика для обратной совместимости
                    if (client.inviteServerId) {
                        const serverExists = client.servers.some(s => s.id === client.inviteServerId);
                        if (serverExists) {
                            client.currentServerId = client.inviteServerId;
                            await import('./RoomManager.js').then(module => {
                                return module.default.loadRoomsForServer(client, client.inviteServerId);
                            });
                            client.startSyncInterval();
                            return;
                        }
                    }

                    if (client.currentServerId) {
                        await import('./RoomManager.js').then(module => {
                            return module.default.loadRoomsForServer(client, client.currentServerId);
                        });
                        client.startSyncInterval();
                    }
                    if (client.currentRoom) {
                        await client.reconnectToRoom(client.currentRoom);
                    }
                }
            } catch (error) {
                alert('Ошибка: ' + error.message);
            }
        };

        submitBtn.addEventListener('click', handleSubmit);
        passwordInput.addEventListener('keypress', e => {
            if (e.key === 'Enter') handleSubmit();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
        
        // НОВОЕ: Инициализируем InviteManager при показе модального окна
        InviteManager.init(client);
    }
}

export default AuthManager;
