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

static addMember(memberData) {
    if (!memberData.userId) {
        console.error('Member data must contain userId');
        return;
    }

    // 🔴🔴🔴 АГРЕССИВНЫЙ ДЕБАГ: Логируем ВСЕ входящие данные
    console.group('🔴🔴🔴 [DEBUG] MEMBERS MANAGER: addMember CALLED');
    console.log('🎯 [DEBUG] RAW INPUT memberData:', JSON.stringify(memberData, null, 2));
    console.groupEnd();

    const processedMemberData = {
        userId: memberData.userId,
        username: memberData.username || `User_${memberData.userId.substr(0, 8)}`,
        isMicActive: memberData.isMicActive || false,
isOnline: memberData.isOnline !== undefined ? memberData.isOnline : (this.members.has(memberData.userId) ? this.members.get(memberData.userId).isOnline : true),
        clientId: memberData.clientId || null
    };

    // 🔴🔴🔴 АГРЕССИВНЫЙ ДЕБАГ: Логируем обработанные данные
    console.group('🔴🔴🔴 [DEBUG] MEMBERS MANAGER: addMember PROCESSED');
    console.log('🎯 [DEBUG] PROCESSED memberData:', JSON.stringify(processedMemberData, null, 2));
    console.groupEnd();

    // Если пользователь уже существует, обновляем его данные.
    // Если нет — добавляем нового.
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

    static updateAllMembers(members) {
        this.members.clear();
        members.forEach(member => this.addMember(member));
    }


static setupSocketHandlers(client) {
    if (!client.socket) return;
    client.socket.on('room-participants', (participants) => {
        this.updateAllMembers(participants);
    });

    // --- ИЗМЕНЕННЫЙ ОБРАБОТЧИК ---
    // Было: client.socket.on('user-joined', (user) => { this.addMember(user); });
    // Стало:
client.socket.on('user-joined', (user) => {
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
            isOnline: true // Явно устанавливаем статус онлайн для нового пользователя
        });
    }
    UIManager.addMessage('System', `Пользователь ${user.username} присоединился к комнате`);
});
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---

client.socket.on('user-left', (data) => {
    console.log('User left (OFFLINE):', data);
    // Обновляем существующего пользователя, устанавливая isOnline: false
    this.updateMember(data.userId, { isOnline: false });
    // Получаем имя пользователя из списка, чтобы отобразить в сообщении
    const member = this.getMember(data.userId);
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
