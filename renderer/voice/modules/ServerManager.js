import UIManager from './UIManager.js';
import RoomManager from './RoomManager.js';
import InviteManager from './InviteManager.js';

class ServerManager {
    static cachedServers = null;
    static lastUpdateTime = 0;
    static CACHE_DURATION = 30000; // 30 секунд кеширования

    static getLocalStorageKey(client) {
        return client.userId ? `voiceChatServers_${client.userId}` : null;
    }

    static saveServersToLocalStorage(client) {
        if (!client.userId) return;
        const key = this.getLocalStorageKey(client);
        const serversData = {
            servers: client.servers,
            timestamp: Date.now()
        };
        localStorage.setItem(key, JSON.stringify(serversData));
    }

    static loadServersFromLocalStorage(client) {
        if (!client.userId) return [];
        const key = this.getLocalStorageKey(client);
        const data = localStorage.getItem(key);
        if (data) {
            try {
                const serversData = JSON.parse(data);
                return serversData.servers || [];
            } catch (e) {
                return [];
            }
        }
        return [];
    }

    static async loadServers(client, forceUpdate = false) {
        try {
            // Используем кеширование для уменьшения запросов
            const now = Date.now();
            if (!forceUpdate && this.cachedServers && (now - this.lastUpdateTime) < this.CACHE_DURATION) {
                client.servers = this.cachedServers;
                this.renderServers(client);
                return true;
            }
            
            let servers = [];
            
            try {
                const res = await fetch(`${client.API_SERVER_URL}/api/servers`, {
                    headers: { 'Authorization': `Bearer ${client.token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    servers = Array.isArray(data.servers) ? data.servers : [];
                    
                    // Обновляем кеш
                    this.cachedServers = servers;
                    this.lastUpdateTime = now;
                }
            } catch (apiError) {
                servers = this.loadServersFromLocalStorage(client);
            }
            
            client.servers = servers;
            this.renderServers(client);
            return true;
        } catch (error) {
            return false;
        }
    }

    static renderServers(client) {
        const serversList = document.querySelector('.servers-list');
        if (!serversList) return;

        serversList.innerHTML = '';
        
        if (client.servers.length === 0) {
            serversList.innerHTML = '<div class="no-results">Нет серверов</div>';
            return;
        }
        
        client.servers.forEach(server => {
            const serverElement = document.createElement('div');
            serverElement.className = 'server-item';
            serverElement.dataset.server = server.id;
            
            const isOwner = server.ownerId === client.userId;
            const isMember = server.members && server.members.includes(client.userId);
            
            serverElement.innerHTML = `🏠 ${server.name} ${isOwner ? '<span class="owner-badge">(Вы)</span>' : ''}`;
            
            serverElement.addEventListener('click', () => {
                client.currentServerId = server.id;
                client.currentServer = server;
                
                // Сохраняем выбор сервера
                localStorage.setItem('lastServerId', server.id);
                
                if (client.serverSearchInput) {
                    client.serverSearchInput.value = '';
                }
                
                setTimeout(() => {
                    RoomManager.loadRoomsForServer(client, server.id);
                    client.showPanel('rooms');
                }, 100);
            });
            
            const actionButtons = document.createElement('div');
            actionButtons.className = 'server-actions';
            
            if (isOwner) {
                // Кнопка для создания инвайта
                const inviteBtn = document.createElement('button');
                inviteBtn.className = 'server-action-btn';
                inviteBtn.innerHTML = '🔗';
                inviteBtn.title = 'Создать приглашение';
                inviteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.createServerInvite(client, server.id);
                });
                
                const shareBtn = document.createElement('button');
                shareBtn.className = 'server-action-btn';
                shareBtn.innerHTML = '📋';
                shareBtn.title = 'Скопировать ссылку';
                shareBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.copyServerInviteLink(client, server.id);
                });
                
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'server-action-btn';
                deleteBtn.innerHTML = '✕';
                deleteBtn.title = 'Удалить';
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteServer(client, server.id);
                });
                
                actionButtons.appendChild(inviteBtn);
                actionButtons.appendChild(shareBtn);
                actionButtons.appendChild(deleteBtn);
            } else if (isMember) {
                const leaveBtn = document.createElement('button');
                leaveBtn.className = 'server-action-btn leave-btn';
                leaveBtn.innerHTML = '🚪';
                leaveBtn.title = 'Покинуть сервер';
                leaveBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.leaveServer(client, server.id);
                });
                
                actionButtons.appendChild(leaveBtn);
            }
            
            serverElement.appendChild(actionButtons);
            serversList.appendChild(serverElement);
        });
    }

    static async createServerInvite(client, serverId) {
        try {
            const invite = await InviteManager.createServerInvite(serverId);
            
            if (invite) {
                const inviteLink = InviteManager.generateInviteLink(invite.code);
                
                UIManager.openModal('Приглашение создано', `
                    <p>Приглашение для сервера создано!</p>
                    <div class="invite-link-container">
                        <input type="text" id="inviteLinkInput" value="${inviteLink}" readonly>
                        <button onclick="navigator.clipboard.writeText('${inviteLink}').then(() => alert('Ссылка скопирована!'))">Копировать</button>
                    </div>
                    <p>Ссылка действительна до: ${new Date(invite.expiresAt).toLocaleDateString()}</p>
                `, () => {
                    UIManager.closeModal();
                });
            }
        } catch (error) {
            console.error('Ошибка создания инвайта:', error);
            UIManager.showError('Не удалось создать приглашение: ' + error.message);
        }
    }

    static async copyServerInviteLink(client, serverId) {
        try {
            const invites = await InviteManager.getServerInvites(serverId);
            
            if (invites && invites.length > 0) {
                const activeInvite = invites.find(invite => new Date(invite.expiresAt) > new Date());
                
                if (activeInvite) {
                    InviteManager.copyInviteLink(activeInvite.code);
                    return;
                }
            }
            
            const invite = await InviteManager.createServerInvite(serverId);
            if (invite) {
                InviteManager.copyInviteLink(invite.code);
            }
        } catch (error) {
            console.error('Ошибка копирования ссылки инвайта:', error);
            UIManager.showError('Не удалось скопировать ссылку приглашения');
        }
    }

    static async createServer(client) {
        const name = prompt('Введите название сервера:');
        if (!name || name.length < 3) {
            alert('Название должно быть от 3 символов');
            return;
        }
        
        try {
            const res = await fetch(`${client.API_SERVER_URL}/api/servers`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${client.token}`
                },
                body: JSON.stringify({ 
                    name: name.trim(), 
                    userId: client.userId, 
                    token: client.token 
                })
            });
            
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                const errorMessage = errorData.error || 'Не удалось создать сервер';
                
                if (errorMessage.includes('уже существует')) {
                    alert(`Ошибка: ${errorMessage}. Выберите другое название.`);
                } else if (errorMessage.includes('Превышен лимит')) {
                    alert(`Ошибка: ${errorMessage}`);
                } else {
                    throw new Error(errorMessage);
                }
                return;
            }
            
            const data = await res.json();
            const serverData = data.server;
            
            client.servers.push(serverData);
            this.saveServersToLocalStorage(client);
            this.renderServers(client);
            client.currentServerId = serverData.id;
            client.currentServer = serverData;
            
            // Сохраняем выбор сервера
            localStorage.setItem('lastServerId', serverData.id);
            
            await RoomManager.loadRoomsForServer(client, client.currentServerId);
            
        } catch (error) {
            alert('Ошибка: ' + error.message);
        }
    }

    static deleteServer(client, serverId) {
        if (!confirm('Вы уверены, что хотите удалить этот сервер? Все комнаты будут удалены.')) return;
        
        const serverIndex = client.servers.findIndex(s => s.id === serverId);
        if (serverIndex !== -1) {
            const serverName = client.servers[serverIndex].name;
            client.servers = client.servers.filter(server => server.id !== serverId);
            this.saveServersToLocalStorage(client);
            this.renderServers(client);
            
            if (client.currentServerId === serverId) {
                client.currentServerId = null;
                client.currentServer = null;
                
                // Очищаем сохраненное состояние
                localStorage.removeItem('lastServerId');
                localStorage.removeItem('lastRoomId');
            }
            
            UIManager.addMessage('System', `✅ Сервер "${serverName}" удален`);
        }
    }

    static async searchServers(client, query) {
        try {
            if (!query || query.length < 2) {
                this.renderServers(client);
                return;
            }

            const res = await fetch(`${client.API_SERVER_URL}/api/servers/search?q=${encodeURIComponent(query)}`, {
                headers: { 
                    'Authorization': `Bearer ${client.token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || 'Ошибка поиска');
            }
            
            const data = await res.json();
            this.renderSearchResults(client, data.servers);
        } catch (error) {
            UIManager.showError('Ошибка поиска: ' + error.message);
        }
    }

    static renderSearchResults(client, servers) {
        const serversList = document.querySelector('.servers-list');
        if (!serversList) return;

        serversList.innerHTML = '';
        
        if (servers.length === 0) {
            serversList.innerHTML = '<div class="no-results">Серверы не найдены</div>';
            return;
        }
        
        servers.forEach(server => {
            const serverElement = document.createElement('div');
            serverElement.className = 'server-item';
            serverElement.dataset.server = server.id;
            
            const isOwner = server.ownerId === client.userId;
            const isMember = client.servers.some(s => s.id === server.id);
            
            serverElement.innerHTML = `🏠 ${server.name} ${isOwner ? '<span class="owner-badge">(Вы)</span>' : ''} ${!isMember ? '<span class="not-member-badge">(Не участник)</span>' : ''}`;
            
            if (isMember) {
                serverElement.addEventListener('click', () => {
                    client.currentServerId = server.id;
                    client.currentServer = server;
                    
                    // Сохраняем выбор сервера
                    localStorage.setItem('lastServerId', server.id);
                    
                    if (client.serverSearchInput) {
                        client.serverSearchInput.value = '';
                    }
                    
                    setTimeout(() => {
                        RoomManager.loadRoomsForServer(client, server.id);
                        client.showPanel('rooms');
                    }, 100);
                });
            } else {
                serverElement.style.opacity = '0.7';
                serverElement.style.cursor = 'default';
                
                const joinBtn = document.createElement('button');
                joinBtn.className = 'server-action-btn join-btn';
                joinBtn.innerHTML = '➕';
                joinBtn.title = 'Присоединиться';
                joinBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.joinServer(client, server.id);
                });
                
                serverElement.appendChild(joinBtn);
            }
            
            if (isOwner) {
                const actionButtons = document.createElement('div');
                actionButtons.className = 'server-actions';
                
                const shareBtn = document.createElement('button');
                shareBtn.className = 'server-action-btn';
                shareBtn.innerHTML = '🔗';
                shareBtn.title = 'Пригласить';
                shareBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.copyServerInviteLink(client, server.id);
                });
                
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'server-action-btn';
                deleteBtn.innerHTML = '✕';
                deleteBtn.title = 'Удалить';
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteServer(client, server.id);
                });
                
                actionButtons.appendChild(shareBtn);
                actionButtons.appendChild(deleteBtn);
                serverElement.appendChild(actionButtons);
            }
            
            serversList.appendChild(serverElement);
        });
    }

    static async joinServer(client, serverId) {
        try {
            const res = await fetch(`${client.API_SERVER_URL}/api/servers/${serverId}/join`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${client.token}`
                },
                body: JSON.stringify({ userId: client.userId, token: client.token })
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Не удалось присоединиться');
            }

            const data = await res.json();
            const server = data.server;

            const exists = client.servers.some(s => s.id === server.id);
            if (!exists) {
                client.servers.push(server);
                this.saveServersToLocalStorage(client);
            }

            if (client.serverSearchInput) {
                client.serverSearchInput.value = '';
            }

            // Сохраняем выбор сервера
            localStorage.setItem('lastServerId', server.id);
            
            this.renderServers(client);
            client.showPanel('servers');
            
            UIManager.addMessage('System', `✅ Вы присоединились к "${server.name}"`);

        } catch (error) {
            UIManager.showError(`❌ Не удалось присоединиться: ${error.message}`);
        }
    }

    static async leaveServer(client, serverId) {
        if (!confirm('Вы уверены, что хотите покинуть этот сервер?')) return;
        
        try {
            const res = await fetch(`${client.API_SERVER_URL}/api/servers/${serverId}/leave`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${client.token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || 'Не удалось покинуть сервер');
            }
            
            client.servers = client.servers.filter(server => server.id !== serverId);
            this.saveServersToLocalStorage(client);
            
            // Очищаем сохраненное состояние, если выходим с текущего сервера
            if (client.currentServerId === serverId) {
                client.currentServerId = null;
                client.currentServer = null;
                client.currentRoom = null;
                
                localStorage.removeItem('lastServerId');
                localStorage.removeItem('lastRoomId');
            }
            
            this.renderServers(client);
            
            UIManager.addMessage('System', `✅ Вы покинули сервер`);
            
        } catch (error) {
            UIManager.showError('Ошибка: ' + error.message);
        }
    }

    static clearSearchAndShowAllServers(client) {
        if (client.serverSearchInput) {
            client.serverSearchInput.value = '';
        }
        
        this.renderServers(client);
    }
}

export default ServerManager;
