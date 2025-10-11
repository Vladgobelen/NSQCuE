import UIManager from './UIManager.js';

class MembersManager {
    static members = new Map();

static updateMember(userId, updates) {
    if (this.members.has(userId)) {
        // 🔴🔴🔴 АГРЕССИВНЫЙ ДЕБАГ: Логируем состояние ПЕРЕД обновлением
        console.group('🔴🔴🔴 [DEBUG] MEMBERS MANAGER: updateMember CALLED');
        console.log('🎯 [DEBUG] TARGET userId:', userId);
        console.log('🎯 [DEBUG] UPDATES received:', JSON.stringify(updates, null, 2));
        console.log('🎯 [DEBUG] STATE BEFORE update:', JSON.stringify(this.members.get(userId), null, 2));
        console.groupEnd();

        const member = { ...this.members.get(userId), ...updates };
        this.members.set(userId, member);

        // 🔴🔴🔴 АГРЕСИВНЫЙ ДЕБАГ: Логируем состояние ПОСЛЕ обновления
        console.group('🔴🔴🔴 [DEBUG] MEMBERS MANAGER: updateMember FINISHED');
        console.log('🎯 [DEBUG] STATE AFTER update:', JSON.stringify(this.members.get(userId), null, 2));
        console.groupEnd();

        UIManager.updateMembersList(Array.from(this.members.values()));
        // Обновляем UI для конкретного участника
        UIManager.updateMemberMicState(userId, updates.isMicActive);
    }
}

// modules/MembersManager.js
static addMember(memberData) {
    if (!memberData.userId) {
        console.error('Member data must contain userId');
        return;
    }
    console.group('🔴🔴🔴 [DEBUG] MEMBERS MANAGER: addMember CALLED');
    console.log('🎯 [DEBUG] RAW INPUT memberData:', JSON.stringify(memberData, null, 2));
    console.groupEnd();

    // 🔴🔴🔴 КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ:
    // Получаем текущего пользователя, если он уже существует.
    const existingMember = this.members.get(memberData.userId);
    let isCurrentlyOnline = true; // По умолчанию true для нового пользователя

    if (existingMember) {
        isCurrentlyOnline = existingMember.isOnline;
        // 🔴🔴🔴 ДОПОЛНИТЕЛЬНАЯ ЗАЩИТА: Если это текущий пользователь, ВСЕГДА сохраняем его статус как true.
        if (this.client && memberData.userId === this.client.userId) {
            isCurrentlyOnline = true;
        }
    }

    const processedMemberData = {
        userId: memberData.userId,
        username: memberData.username || `User_${memberData.userId.substr(0, 8)}`,
        isMicActive: memberData.isMicActive || false,
        isOnline: memberData.isOnline !== undefined ? memberData.isOnline : isCurrentlyOnline,
        clientId: memberData.clientId || null
    };

    console.group('🔴🔴🔴 [DEBUG] MEMBERS MANAGER: addMember PROCESSED');
    console.log('🎯 [DEBUG] PROCESSED memberData:', JSON.stringify(processedMemberData, null, 2));
    console.groupEnd();

    this.members.set(processedMemberData.userId, processedMemberData);
    UIManager.updateMembersList(Array.from(this.members.values()));
}
    static removeMember(userId) {
        if (this.members.has(userId)) {
            this.members.delete(userId);
            UIManager.updateMembersList(Array.from(this.members.values()));
        }
    }

    static clearMembers() {
        this.members.clear();
        UIManager.updateMembersList([]);
    }

// modules/MembersManager.js

static updateAllMembers(members) {
    console.log('🎯 [MEMBERS MANAGER] updateAllMembers called. Replacing entire members list.');
    console.log('🎯 [MEMBERS MANAGER] New members list (in order):', members.map(m => `${m.username} (${m.isOnline ? 'ONLINE' : 'OFFLINE'})`));
    
    // ✅ 1. Полностью очищаем внутреннюю карту
    this.members.clear();
    
    // ✅ 2. Заполняем карту в ТОЧНОМ порядке, в котором пришли данные от сервера
    members.forEach(member => {
        this.members.set(member.userId, member);
    });
    
    // ✅ 3. ГЛАВНОЕ ИЗМЕНЕНИЕ: Передаем в UI исходный массив `members`, а не Array.from(this.members.values())
    // Это гарантирует, что порядок в UI будет ТОЧНО таким же, как на сервере.
    UIManager.updateMembersList(members); // <-- Передаем `members`, а не `Array.from(this.members.values())`
    
    console.log('✅ [MEMBERS MANAGER] Members list fully replaced and rendered in correct order.');
}

static setupSocketHandlers(client) {
    if (!client.socket) return;

    client.socket.on('room-participants', (participants) => {
        this.updateAllMembers(participants);
    });

    // --- ИЗМЕНЕННЫЙ ОБРАБОТЧИК user-joined ---
    client.socket.on('user-joined', async (user) => {
        console.log('User joined (ONLINE):', user);
        // Проверяем, существует ли пользователь
        if (this.members.has(user.userId)) {
            // Если существует, обновляем его данные и статус онлайн
            this.updateMember(user.userId, { 
                ...user,
                isOnline: true 
            });
        } else {
            // Если не существует, добавляем нового пользователя
            this.addMember({
                ...user,
                isOnline: true
            });
        }
        UIManager.addMessage('System', `Пользователь ${user.username} присоединился к комнате`);
    });

    // --- ИСПРАВЛЕННЫЙ ОБРАБОТЧИК user-left ---
    client.socket.on('user-left', async (data) => {
        console.log('User left:', data);
        // Получаем имя пользователя из списка, чтобы отобразить в сообщении
        const member = MembersManager.getMember(data.userId);
        if (member) {
            UIManager.addMessage('System', `Пользователь ${member.username} покинул комнату`);
        } else {
            UIManager.addMessage('System', `Пользователь покинул комнату`);
        }
    });

    client.socket.on('user-mic-state', (data) => {
        if (data.userId) {
            this.updateMember(data.userId, { isMicActive: data.isActive });
        } else if (data.clientID) {
            // Находим пользователя по clientID
            const members = Array.from(this.members.values());
            const member = members.find(m => m.clientId === data.clientID);
            if (member) {
                this.updateMember(member.userId, { isMicActive: data.isActive });
            }
        }
    });
}


    static setupSSEHandlers() {
        console.log('SSE handlers for members are setup in TextChatManager');
    }

    static getMembers() {
        return Array.from(this.members.values());
    }

    static getMember(userId) {
        return this.members.get(userId);
    }

    static isCurrentUser(client, userId) {
        return client.userId === userId;
    }

    static initializeRoomMembers(client, participants) {
        console.log('Initializing room members with:', participants);
        this.clearMembers();
        participants.forEach(participant => this.addMember(participant));
    }
}

export default MembersManager;
