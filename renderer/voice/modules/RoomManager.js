import UIManager from './UIManager.js';
import MediaManager from './MediaManager.js';
import TextChatManager from './TextChatManager.js';
import MembersManager from './MembersManager.js';
import InviteManager from './InviteManager.js';

class RoomManager {
  static async loadRoomsForServer(client, serverId) {
    try {
      client.currentServerId = serverId;
      client.currentServer = client.servers.find(s => s.id === serverId) || null;
      UIManager.updateStatus('Загрузка комнат...', 'connecting');
      
      const res = await fetch(`${client.API_SERVER_URL}/api/servers/${serverId}/rooms`, {
        headers: {
          'Authorization': `Bearer ${client.token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(`Не удалось загрузить комнаты: ${errorData.error || res.statusText}`);
      }
      
      const data = await res.json();
      if (!data || !Array.isArray(data.rooms)) {
        throw new Error('Некорректные данные от сервера');
      }
      
      // СОХРАНЯЕМ КОМНАТЫ В КЛИЕНТЕ
      client.rooms = data.rooms;
      
      this.renderRooms(client, data.rooms);
      UIManager.updateStatus('Комнаты загружены', 'normal');
      
    } catch (error) {
      UIManager.updateStatus('Ошибка загрузки комнат', 'error');
      UIManager.showError('Не удалось загрузить комнаты: ' + error.message);
    }
  }

  static async joinRoom(client, roomId) {
    try {
      const res = await fetch(`${client.API_SERVER_URL}/api/rooms/${roomId}/join`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${client.token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Ошибка присоединения к комнате: ${res.status}`);
      }
      
      const data = await res.json();
      client.currentRoom = roomId;
      client.roomType = 'voice';
      
      try {
        await MediaManager.connect(client, roomId, data.mediaData);
        UIManager.updateRoomUI(client);
        await MediaManager.startConsumingProducers(client);
      } catch (mediaError) {
        UIManager.showError('Не удалось подключиться к комнате: ' + mediaError.message);
        throw mediaError;
      }
      
      UIManager.updateRoomUI(client);
      TextChatManager.joinTextRoom(client, roomId);
      await TextChatManager.loadMessages(client, roomId);
      
      UIManager.addMessage('System', `✅ Вы присоединились к комнате`);
      return true;
    } catch (error) {
      UIManager.showError('Не удалось присоединиться к комнате: ' + error.message);
      throw error;
    }
  }

  static async leaveRoom(client) {
    if (!client.currentRoom) return;
    
    try {
      if (client.isConnected) {
        MediaManager.disconnect(client);
      }
      
      await fetch(`${client.API_SERVER_URL}/api/rooms/${client.currentRoom}/leave`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${client.token}`,
          'Content-Type': 'application/json'
        }
      });
      
      MembersManager.clearMembers();
      
      client.currentRoom = null;
      client.roomType = null;
      
      UIManager.updateRoomUI(client);
      UIManager.addMessage('System', `✅ Вы покинули комнату`);
      return true;
    } catch (error) {
      UIManager.showError('Ошибка при покидании комнаты: ' + error.message);
      return false;
    }
  }

  static async createRoom(client, serverId, name) {
    if (!name || name.length < 3) {
      alert('Название должно быть от 3 символов');
      return;
    }
    
    try {
      const res = await fetch(`${client.API_SERVER_URL}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${client.token}`
        },
        body: JSON.stringify({
          name: name.trim(),
          serverId: serverId,
          type: 'voice',
          userId: client.userId,
          token: client.token
        })
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const errorMessage = errorData.error || 'Не удалось создать комнату';
        if (errorMessage.includes('уже существует')) {
          alert(`Ошибка: ${errorMessage}. Выберите другое название.`);
        } else {
          throw new Error(errorMessage);
        }
        return;
      }
      
      const data = await res.json();
      const roomData = data.room;
      
      if (client.currentServerId === serverId) {
        await this.loadRoomsForServer(client, serverId);
      }
      
      UIManager.addMessage('System', `✅ Создана комната "${name}"`);
    } catch (error) {
      alert('Ошибка: ' + error.message);
    }
  }

  static async createRoomInvite(client, roomId) {
    try {
      const invite = await InviteManager.createRoomInvite(roomId);
      
      if (invite) {
        const inviteLink = InviteManager.generateInviteLink(invite.code);
        
        UIManager.openModal('Приглашение создано', `
          <p>Приглашение для комнаты создано!</p>
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
      console.error('Ошибка создания инвайта комнаты:', error);
      UIManager.showError('Не удалось создать приглашение: ' + error.message);
    }
  }

  static async copyRoomInviteLink(client, roomId) {
    try {
      const invites = await InviteManager.getRoomInvites(roomId);
      
      if (invites && invites.length > 0) {
        const activeInvite = invites.find(invite => new Date(invite.expiresAt) > new Date());
        
        if (activeInvite) {
          InviteManager.copyInviteLink(activeInvite.code);
          return;
        }
      }
      
      const invite = await InviteManager.createRoomInvite(roomId);
      if (invite) {
        InviteManager.copyInviteLink(invite.code);
      }
    } catch (error) {
      console.error('Ошибка копирования ссылки инвайта комнаты:', error);
      UIManager.showError('Не удалось скопировать ссылку приглашения');
    }
  }

  static async deleteRoom(client, roomId) {
    if (!confirm('Вы уверены, что хотите удалить эту комнату?')) return;
    
    try {
      const res = await fetch(`${client.API_SERVER_URL}/api/rooms/${roomId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${client.token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Не удалось удалить комнату');
      }
      
      if (client.currentServerId) {
        await this.loadRoomsForServer(client, client.currentServerId);
      }
      
      if (client.currentRoom === roomId) {
        await this.leaveRoom(client);
      }
      
      UIManager.addMessage('System', `✅ Комната удалена`);
    } catch (error) {
      UIManager.showError('Ошибка: ' + error.message);
    }
  }

  static async reconnectToRoom(client, roomId) {
    try {
      UIManager.addMessage('System', 'Переподключение к комнате...');
      
      client.wasMicActiveBeforeReconnect = client.isMicActive;
      
      if (client.isMicActive && client.mediaData) {
        await MediaManager.stopMicrophone(client);
      }
      
      await this.leaveRoom(client);
      
      client.isReconnecting = true;
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const result = await this.joinRoom(client, roomId);
      
      client.isReconnecting = false;
      
      if (client.wasMicActiveBeforeReconnect && client.mediaData) {
        setTimeout(async () => {
          try {
            await MediaManager.startMicrophone(client);
            client.wasMicActiveBeforeReconnect = false;
          } catch (error) {
            UIManager.showError('Не удалось восстановить микрофон после переподключения');
          }
        }, 1000);
      }
      
      return result;
    } catch (error) {
      client.isReconnecting = false;
      UIManager.addMessage('System', 'Ошибка переподключения: ' + error.message);
      throw error;
    }
  }

  static renderRooms(client, rooms) {
    const roomsList = document.querySelector('.rooms-list');
    if (!roomsList) return;

    roomsList.innerHTML = '';
    
    rooms.forEach(room => {
      const roomElement = document.createElement('div');
      roomElement.className = 'room-item';
      roomElement.dataset.room = room.id;
      
      const isOwner = room.ownerId === client.userId;
      const isMember = client.currentServer?.members?.includes(client.userId);
      
      roomElement.innerHTML = `🔊 ${room.name} ${isOwner ? '<span class="owner-badge">(Вы)</span>' : ''}`;
      
roomElement.addEventListener('click', async (e) => {
    e.stopPropagation();
    
    // Если это уже текущая комната, не делаем ничего
    if (client.currentRoom === room.id) {
        return;
    }
    
    try {
        await client.joinRoom(room.id);
        
        localStorage.setItem('lastRoomId', room.id);
        localStorage.setItem('lastServerId', client.currentServerId);
    } catch (error) {
        console.error('Error joining room:', error);
        UIManager.showError('Не удалось присоединиться к комнате: ' + error.message);
    }
});
      if (isMember) {
        const actionButtons = document.createElement('div');
        actionButtons.className = 'room-actions';
        
        const shareBtn = document.createElement('button');
        shareBtn.className = 'room-action-btn';
        shareBtn.innerHTML = '📋';
        shareBtn.title = 'Скопировать ссылку на комнату';
        shareBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            const invite = await InviteManager.createRoomInvite(room.id);
            const inviteLink = InviteManager.generateInviteLink(invite.code);
            
            await navigator.clipboard.writeText(inviteLink);
            UIManager.showError('Ссылка скопирована!');
          } catch (error) {
            console.error('Ошибка копирования ссылки:', error);
            UIManager.showError('Не удалось скопировать ссылку');
          }
        });
        
        actionButtons.appendChild(shareBtn);
        
        if (isOwner) {
          const inviteBtn = document.createElement('button');
          inviteBtn.className = 'room-action-btn';
          inviteBtn.innerHTML = '🔗';
          inviteBtn.title = 'Создать приглашение';
          inviteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.createRoomInvite(client, room.id);
          });
          
          const deleteBtn = document.createElement('button');
          deleteBtn.className = 'room-action-btn';
          deleteBtn.innerHTML = '✕';
          deleteBtn.title = 'Удалить комнату';
          deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteRoom(client, room.id);
          });
          
          actionButtons.appendChild(inviteBtn);
          actionButtons.appendChild(deleteBtn);
        }
        
        roomElement.appendChild(actionButtons);
      }
      
      roomsList.appendChild(roomElement);
    });
  }
}

export default RoomManager;
