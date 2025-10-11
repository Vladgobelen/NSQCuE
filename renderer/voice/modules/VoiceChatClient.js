import MediaManager from './MediaManager.js';
import RoomManager from './RoomManager.js';
import ServerManager from './ServerManager.js';
import UIManager from './UIManager.js';
import Utils from './Utils.js';
import TextChatManager from './TextChatManager.js';
import UserPresenceManager from './UserPresenceManager.js';
import InviteManager from './InviteManager.js';
import MembersManager from './MembersManager.js';
import AuthManager from './AuthManager.js';

class VoiceChatClient {
    constructor() {
        this.API_SERVER_URL = 'https://ns.fiber-gate.ru';
        this.CHAT_API_URL = `${this.API_SERVER_URL}/api/join`;
        this.clientID = Utils.generateClientID();
        this.device = null;
        this.sendTransport = null;
        this.recvTransport = null;
        this.audioProducer = null;
        this.consumerState = new Map();
        this.stream = null;
        this.isMicActive = false;
        this.currentRoom = null;
        this.currentServerId = null;
        this.currentServer = null;
        this.servers = [];
        this.rooms = [];
        this.keepAliveInterval = null;
        this.bitrate = 32000;
        this.dtxEnabled = true;
        this.fecEnabled = true;
        this.isConnected = false;
        this.mediaData = null;
        this.userId = null;
        this.token = null;
        this.username = null;
        this.syncInterval = null;
        this.activePanel = 'servers';
        this.inviteServerId = null;
        this.isCreatingRoom = false;
        this.socket = null;
        this.sseConnection = null;
        this.wasMicActiveBeforeReconnect = false;
        this.isReconnecting = false;
        this.pendingInviteCode = null;
        this.useHttpPolling = false;
        this.elements = {};
        this.debouncedSync = Utils.debounce(() => this.startConsuming(), 1000);
        this.pttHotkey = null;
        this.pttTimeoutId = null;
        this.isPTTActive = false;
        this.isMicInitializing = false;
        this.init();
    }

    playSound(soundName) {
        if (typeof Audio === 'undefined') return;
        const audio = new Audio(`./sounds/${soundName}.mp3`);
        audio.volume = 0.6;
        // Играем звук только если аудиоконтекст разблокирован
        audio.play().catch(err => {
            // Игнорируем ошибки (например, "play() failed because user didn't interact")
            console.debug(`[Sound] Could not play ${soundName}:`, err.message);
        });
    }

    async init() {
        console.log('VoiceChatClient initializing...');
        this.initElements();
        this.initEventListeners();
        UIManager.setClient(this);
        UserPresenceManager.init(this);
        InviteManager.init(this);
        // Подписываемся на событие глобального PTT
        if (window.electronAPI?.onPTTPressed) {
            window.electronAPI.onPTTPressed(() => {
                this.handlePTTPressed();
            });
        }
        // Загружаем сохраненный PTT-хоткей
        if (window.electronAPI?.getPTTHotkey) {
            try {
                this.pttHotkey = await window.electronAPI.getPTTHotkey();
                if (this.pttHotkey) {
                    console.log('Loaded PTT hotkey:', this.pttHotkey);
                }
            } catch (error) {
                console.error('Error loading PTT hotkey:', error);
            }
        }
        await this.initAutoConnect();
        this.initMessageReadObserver();
    }

    initElements() {
        console.log('Initializing UI elements...');
        this.elements.micButton = document.querySelector('.mic-button');
        this.elements.micToggleBtn = document.querySelector('.mic-toggle-btn');
        this.elements.messageInput = document.querySelector('.message-input');
        this.elements.sendButton = document.querySelector('.send-btn');
        this.elements.currentRoomTitle = document.querySelector('.current-room-title');
        this.elements.toggleSidebarBtn = document.querySelector('.toggle-sidebar-btn');
        this.elements.toggleMembersBtn = document.querySelector('.toggle-members-btn');
        this.elements.settingsBtn = document.querySelector('.settings-btn');
        this.elements.closePanelBtn = document.querySelector('.close-panel-btn');
        this.elements.closeSidebarBtn = document.querySelector('.close-sidebar-btn');
        this.elements.createServerBtn = document.querySelector('.create-server-btn');
        this.elements.createRoomBtn = document.querySelector('.create-room-btn');
        this.elements.serversToggleBtn = document.querySelector('#serversToggle');
        this.elements.roomsToggleBtn = document.querySelector('#roomsToggle');
        this.elements.serversList = document.querySelector('.servers-list');
        this.elements.roomsList = document.querySelector('.rooms-list');
        this.elements.membersList = document.querySelector('.members-list');
        this.elements.messagesContainer = document.querySelector('.messages-container');
        this.elements.serversPanel = document.getElementById('servers-panel'); 
        this.elements.roomsPanel = document.getElementById('rooms-panel'); 
        this.elements.sidebar = document.querySelector('.sidebar');
        this.elements.membersPanel = document.querySelector('.members-panel');
        this.elements.serverSearchInput = document.querySelector('#serverSearch');
        this.elements.clearSearchBtn = document.querySelector('#clearSearchBtn');
        this.elements.backBtn = document.querySelector('.back-btn');
        this.elements.pttSetupBtn = document.querySelector('.ptt-setup-btn');
        if (this.elements.clearSearchBtn) {
            this.elements.clearSearchBtn.addEventListener('click', () => {
                ServerManager.clearSearchAndShowAllServers(this);
            });
        } else {
            console.warn('Clear search button not found');
        }
    }

    initEventListeners() {
        console.log('Setting up event listeners...');
        if (this.elements.micButton) {
            this.elements.micButton.addEventListener('click', () => this.toggleMicrophone());
        }
        if (this.elements.micToggleBtn) {
            this.elements.micToggleBtn.addEventListener('click', () => this.toggleMicrophone());
        }
        if (this.elements.messageInput) {
            this.elements.messageInput.addEventListener('keypress', e => {
                if (e.key === 'Enter') {
                    this.sendMessage(this.elements.messageInput.value);
                    this.elements.messageInput.value = '';
                }
            });
        }
        if (this.elements.sendButton) {
            this.elements.sendButton.addEventListener('click', () => {
                this.sendMessage(this.elements.messageInput.value);
                this.elements.messageInput.value = '';
            });
        }
        if (this.elements.toggleSidebarBtn) {
            this.elements.toggleSidebarBtn.addEventListener('click', () => {
                this.elements.sidebar.classList.toggle('open');
                if (this.elements.sidebar.classList.contains('open')) {
                    this.elements.membersPanel.classList.remove('open');
                }
            });
        }
        if (this.elements.toggleMembersBtn) {
            this.elements.toggleMembersBtn.addEventListener('click', () => {
                this.elements.membersPanel.classList.toggle('open');
                if (this.elements.membersPanel.classList.contains('open')) {
                    this.elements.sidebar.classList.remove('open');
                }
            });
        }
        if (this.elements.closePanelBtn) {
            this.elements.closePanelBtn.addEventListener('click', () => {
                this.elements.membersPanel.classList.remove('open');
            });
        }
        if (this.elements.closeSidebarBtn) {
            this.elements.closeSidebarBtn.addEventListener('click', () => {
                this.elements.sidebar.classList.remove('open');
            });
        }
        if (this.elements.settingsBtn) {
            this.elements.settingsBtn.addEventListener('click', () => {
                UIManager.openSettings(this);
            });
        }
        if (this.elements.createServerBtn) {
            this.elements.createServerBtn.addEventListener('click', () => {
                ServerManager.createServer(this);
            });
        }
        if (this.elements.createRoomBtn) {
            this.elements.createRoomBtn.addEventListener('click', () => {
                if (!this.currentServerId) {
                    alert('Сначала выберите сервер');
                    return;
                }
                UIManager.openCreateRoomModal(this, (name) => {
                    RoomManager.createRoom(this, this.currentServerId, name);
                });
            });
        }
        if (this.elements.serversToggleBtn) {
            this.elements.serversToggleBtn.addEventListener('click', () => {
                ServerManager.clearSearchAndShowAllServers(this);
                this.showPanel('servers');
            });
        }
        if (this.elements.roomsToggleBtn) {
            this.elements.roomsToggleBtn.addEventListener('click', () => {
                this.showPanel('rooms');
            });
        }
        if (this.elements.serverSearchInput) {
            this.elements.serverSearchInput.addEventListener('input', (e) => {
                this.searchServers(e.target.value);
            });
        }
        if (this.elements.backBtn) {
            this.elements.backBtn.addEventListener('click', () => {
                this.goBackToMain();
            });
        }
        if (this.elements.pttSetupBtn) {
            this.elements.pttSetupBtn.addEventListener('click', () => {
                this.showPTTSetupModal();
            });
        }
        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
            mainContent.addEventListener('click', (e) => {
                if (!e.target.closest('.message') &&
                    !e.target.closest('.message-input') &&
                    !e.target.closest('.send-btn') &&
                    !e.target.closest('.mic-toggle-btn') &&
                    !e.target.closest('.settings-btn') &&
                    !e.target.closest('.toggle-members-btn') &&
                    !e.target.closest('.current-room-title') &&
                    !e.target.closest('.toggle-sidebar-btn')) {
                    this.elements.sidebar.classList.remove('open');
                    this.elements.membersPanel.classList.remove('open');
                }
            });
        }
        const unlockBtn = document.getElementById('audio-unlock-btn');
        if (unlockBtn) {
            unlockBtn.addEventListener('click', () => {
                const audio = new Audio();
                audio.muted = true;
                audio.playsInline = true;
                audio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAA=';
                audio.play()
                    .then(() => {
                        console.log('✅ Аудио разблокировано!');
                        unlockBtn.style.display = 'none';
                    })
                    .catch(err => {
                        console.warn('Не удалось разблокировать аудио:', err);
                    });
            });
        }
        if (mainContent) {
            mainContent.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                mainContent.classList.add('drag-over');
            });
            mainContent.addEventListener('dragleave', (e) => {
                e.preventDefault();
                e.stopPropagation();
                mainContent.classList.remove('drag-over');
            });
            mainContent.addEventListener('drop', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                mainContent.classList.remove('drag-over');
                if (!this.currentRoom) {
                    this.showError('Сначала войдите в комнату');
                    return;
                }
                const files = e.dataTransfer.files;
                if (files.length === 0) return;
                const file = files[0];
                if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                    this.showError('Поддерживаются только изображения: JPEG, PNG, WebP');
                    return;
                }
                if (file.size > 5 * 1024 * 1024) {
                    this.showError('Файл слишком большой (макс. 5 МБ)');
                    return;
                }
                try {
                    const imageUrl = await TextChatManager.uploadImage(this, this.currentRoom, file);
                    await TextChatManager.sendMessage(this, imageUrl, 'image');
                } catch (error) {
                    console.error('Ошибка отправки изображения:', error);
                    this.showError('Не удалось отправить изображение: ' + error.message);
                }
            });
        }
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/jpeg,image/png,image/webp';
        fileInput.style.display = 'none';
        fileInput.id = 'image-upload-input';
        document.body.appendChild(fileInput);
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (!this.currentRoom) {
                this.showError('Сначала войдите в комнату');
                return;
            }
            if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                this.showError('Поддерживаются только изображения: JPEG, PNG, WebP');
                return;
            }
            if (file.size > 5 * 1024 * 1024) {
                this.showError('Файл слишком большой (макс. 5 МБ)');
                return;
            }
            try {
                const imageUrl = await TextChatManager.uploadImage(this, this.currentRoom, file);
                await TextChatManager.sendImageMessage(this, imageUrl);
            } catch (error) {
                console.error('Ошибка отправки изображения:', error);
                this.showError('Не удалось отправить изображение: ' + error.message);
            }
            fileInput.value = '';
        });
        const attachBtn = document.querySelector('.attach-btn');
        if (attachBtn) {
            attachBtn.addEventListener('click', () => {
                fileInput.click();
            });
        }
    }

    initMessageReadObserver() {
        this.unreadMessageIds = new Set();
        this.messageObserver = new IntersectionObserver((entries) => {
            const toMark = [];
            entries.forEach(entry => {
                const msgId = entry.target.dataset.messageId;
                if (!msgId) return;
                const readBy = JSON.parse(entry.target.dataset.readBy || '[]');
                const isOwn = entry.target.querySelector('.message-content.own');
                if (isOwn) return;
                if (entry.isIntersecting && !readBy.includes(this.userId)) {
                    toMark.push(msgId);
                    this.unreadMessageIds.delete(msgId);
                } else if (!entry.isIntersecting) {
                    this.unreadMessageIds.add(msgId);
                }
            });
            if (toMark.length > 0) {
                TextChatManager.markMessagesAsRead(this, toMark);
            }
        }, { threshold: 0.5 });
        window.voiceClient = this;
    }

    async sendImageMessage(imageUrl) {
        await TextChatManager.sendImageMessage(this, imageUrl);
    }

    showPanel(panelName) {
        console.log('Showing panel:', panelName);
        const serversPanel = this.elements.serversPanel;
        const roomsPanel = this.elements.roomsPanel;
        const serversToggleBtn = this.elements.serversToggleBtn;
        const roomsToggleBtn = this.elements.roomsToggleBtn;
        if (!serversPanel || !roomsPanel || !serversToggleBtn || !roomsToggleBtn) {
            console.error('Required panel elements not found');
            return;
        }
        this.activePanel = panelName;
        if (panelName === 'servers') {
            serversToggleBtn.classList.add('active');
            roomsToggleBtn.classList.remove('active');
            serversPanel.classList.add('active');
            roomsPanel.classList.remove('active');
        } else {
            serversToggleBtn.classList.remove('active');
            roomsToggleBtn.classList.add('active');
            serversPanel.classList.remove('active');
            roomsPanel.classList.add('active');
        }
    }

    processUrlParams() {
        console.log('Processing URL parameters...');
        const params = new URLSearchParams(window.location.search);
        this.currentServerId = params.get('server');
        this.currentRoom = params.get('room');
        this.inviteServerId = params.get('invite');
        const inviteCode = params.get('invite');
        if (inviteCode && /^[a-zA-Z0-9]{4}$/.test(inviteCode)) {
            this.pendingInviteCode = inviteCode;
            console.log('Found pending invite code:', inviteCode);
        }
        console.log('URL params processed - server:', this.currentServerId, 'room:', this.currentRoom, 'invite:', this.inviteServerId);
    }

    async ensureConsumer(producerId, producerData = {}) {
        console.group('🔄 VoiceChatClient.ensureConsumer - START');
        console.log('🔹 producerId:', producerId);
        console.log('🔹 producerData:', producerData);
        const currentState = this.consumerState.get(producerId);
        if (currentState?.status === 'active') {
            console.log('ℹ️ Consumer already active for:', producerId);
            console.groupEnd();
            return true;
        }
        if (currentState?.status === 'creating') {
            console.log('ℹ️ Consumer already being created for:', producerId);
            console.groupEnd();
            return false;
        }
        this.consumerState.set(producerId, { status: 'creating', consumer: null, lastError: null });
        try {
            console.log('🔄 Starting creation for producer:', producerId);
            const consumer = await MediaManager.createConsumer(this, producerId, 3, producerData);
            this.consumerState.set(producerId, { status: 'active', consumer: consumer, lastError: null });
            console.log('✅ Consumer created and activated for:', producerId);
            console.groupEnd();
            return true;
        } catch (error) {
            console.error('❌ Failed to create consumer for:', producerId, error);
            this.consumerState.set(producerId, { 
                status: 'error', 
                consumer: null, 
                lastError: error 
            });
            if (error.message.includes('consume own') || error.message.includes('own audio')) {
                this.consumerState.set(producerId, { status: 'active', consumer: null, lastError: null });
                console.log('🔇 Own producer marked as handled:', producerId);
            }
            console.groupEnd();
            return false;
        }
    }

    async initAutoConnect() {
        console.log('Starting auto-connect process...');
        this.processUrlParams();
        try {
            const autoLoggedIn = await AuthManager.tryAutoLogin(this);
            if (autoLoggedIn) {
                console.log('Auto-login successful, loading servers...');
                await ServerManager.loadServers(this);
                if (this.pendingInviteCode) {
                    console.log('Applying pending invite:', this.pendingInviteCode);
                    const inviteApplied = await InviteManager.applyPendingInvite();
                    if (inviteApplied) {
                        console.log('Invite applied successfully');
                        this.clearPendingInvite();
                        if (this.currentRoom && this.currentServerId) {
                            console.log('Invite was for a room. Attempting to join room:', this.currentRoom);
                            try {
                                await this.joinRoom(this.currentRoom);
                                console.log('Successfully joined room after invite application');
                            } catch (error) {
                                console.error('Failed to join room after invite application:', error);
                                UIManager.showError('Не удалось присоединиться к комнате после применения инвайта');
                            }
                        }
                        return;
                    } else {
                        console.log('Failed to apply invite, continuing with normal flow');
                    }
                }
                const lastServerId = localStorage.getItem('lastServerId');
                const lastRoomId = localStorage.getItem('lastRoomId');
                if (lastServerId) {
                    console.log('Found last server in localStorage:', lastServerId);
                    const serverExists = this.servers.some(s => s.id === lastServerId);
                    if (serverExists) {
                        this.currentServerId = lastServerId;
                        this.currentServer = this.servers.find(s => s.id === lastServerId);
                        await RoomManager.loadRoomsForServer(this, lastServerId);
                        if (lastRoomId) {
                            console.log('Found last room in localStorage:', lastRoomId);
                            const roomExists = this.rooms.some(room => room.id === lastRoomId);
                            if (roomExists) {
                                this.currentRoom = lastRoomId;
                                await this.reconnectToRoom(lastRoomId);
                                return;
                            }
                        }
                    }
                }
                let targetServerId = null;
                if (this.inviteServerId) {
                    console.log('Processing invite server ID:', this.inviteServerId);
                    const serverExists = this.servers.some(s => s.id === this.inviteServerId);
                    if (serverExists) {
                        targetServerId = this.inviteServerId;
                    } else {
                        const joined = await this.joinServer(this.inviteServerId);
                        if (joined) {
                            targetServerId = this.inviteServerId;
                            await ServerManager.loadServers(this);
                        } else {
                            UIManager.showError('Нет доступа к серверу.');
                        }
                    }
                } else if (this.currentServerId) {
                    console.log('Processing current server ID:', this.currentServerId);
                    const serverExists = this.servers.some(s => s.id === this.currentServerId);
                    if (serverExists) {
                        targetServerId = this.currentServerId;
                    }
                }
                if (targetServerId) {
                    console.log('Setting target server:', targetServerId);
                    this.currentServerId = targetServerId;
                    await RoomManager.loadRoomsForServer(this, targetServerId);
                    if (this.currentRoom) {
                        await this.reconnectToRoom(this.currentRoom);
                    }
                } else {
                    console.log('No target server found, showing auto-connect UI');
                    this.autoConnect();
                }
                return;
            }
            console.log('No auto-login found, showing auth modal');
            AuthManager.showAuthModal(this);
        } catch (err) {
            console.error('Auto connect error:', err);
            UIManager.showError('Критическая ошибка: не удалось загрузить систему авторизации');
        }
    }

    clearPendingInvite() {
        console.log('Clearing pending invite');
        this.pendingInviteCode = null;
        localStorage.removeItem('pending_invite');
        const url = new URL(window.location);
        url.searchParams.delete('invite');
        window.history.replaceState({}, '', url);
    }

    async joinServer(serverId) {
        console.log('Joining server:', serverId);
        try {
            const res = await fetch(`${this.API_SERVER_URL}/api/servers/${serverId}/join`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ userId: this.userId, token: this.token })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Не удалось присоединиться');
            }
            const data = await res.json();
            const server = data.server;
            const exists = this.servers.some(s => s.id === server.id);
            if (!exists) {
                this.servers.push(server);
                ServerManager.saveServersToLocalStorage(this);
            }
            if (this.elements.serverSearchInput) {
                this.elements.serverSearchInput.value = '';
            }
            localStorage.setItem('lastServerId', server.id);
            ServerManager.renderServers(this);
            this.showPanel('servers');
            UIManager.addMessage('System', `✅ Вы присоединились к "${server.name}"`);
            return true;
        } catch (error) {
            console.error('Error joining server:', error);
            UIManager.showError(`❌ Не удалось присоединиться: ${error.message}`);
            return false;
        }
    }

    async joinRoom(roomId) {
        console.log('Joining room:', roomId);
        if (this.currentRoom === roomId && this.isConnected && this.socket && this.socket.connected) {
            console.log('Already connected to this room, updating consumers');
            await this.startConsuming();
            return true;
        }
        try {
            UIManager.addMessage('System', 'Подключение к комнате...');
            this.disconnectFromRoom();
            const res = await fetch(this.CHAT_API_URL, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json', 
                    'Authorization': `Bearer ${this.token}` 
                },
                body: JSON.stringify({ 
                    roomId, 
                    userId: this.userId, 
                    token: this.token, 
                    clientId: this.clientID 
                })
            });
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || `Ошибка входа: ${res.status}`);
            }
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            if (!data.mediaData) {
                throw new Error('No media data received from server');
            }
            this.clientID = data.clientId;
            this.mediaData = data.mediaData;
            this.currentRoom = roomId;
            this.roomType = 'voice';
            localStorage.setItem('lastServerId', this.currentServerId);
            localStorage.setItem('lastRoomId', this.currentRoom);
            this.audioProducer = null;
            await MediaManager.connect(this, roomId, data.mediaData);
            this.setupSocketConnection();
            this.updateMicButtonState();
            if (this.socket) {
                this.socket.emit('subscribe-to-producers', { roomId });
                this.socket.emit('get-current-producers', { roomId });
            }
            UIManager.updateRoomUI(this);
            TextChatManager.joinTextRoom(this, roomId);
            await TextChatManager.loadMessages(this, roomId);
            UIManager.addMessage('System', `✅ Вы присоединились к комнате`);
            if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
                const btn = document.getElementById('ios-audio-unlock');
                if (btn) btn.style.display = 'block';
            }
            return true;
        } catch (e) {
            console.error('Error joining room:', e);
            UIManager.updateStatus('Ошибка: ' + e.message, 'disconnected');
            UIManager.showError('Не удалось присоединиться к комнате: ' + e.message);
            throw e;
        }
    }

    setupSocketConnection() {
        console.log('Setting up socket connection...');
        if (this.socket && this.socket.connected) {
            console.log('Socket already connected, reusing');
            return;
        }
        const currentToken = this.token;
        if (!currentToken) {
            console.log('No token available, skipping socket connection');
            return;
        }
        this.destroySocket();
        try {
            console.log('Creating new socket connection with token:', currentToken);
            this.socket = io(this.API_SERVER_URL, {
                auth: {
                    token: currentToken,
                    userId: this.userId,
                    clientId: this.clientID,
                    username: this.username
                },
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 5000,
                timeout: 20000
            });
            const socket = this.socket;
            socket.on('new-producer', async (data) => {
                console.group('🔴🔴🔴 [DEBUG] SOCKET EVENT: new-producer');
                console.log('🎯 [DEBUG] EVENT DATA RECEIVED:', JSON.stringify(data, null, 2));
                console.log('🎯 [DEBUG] CLIENT STATE - clientID:', this.clientID);
                console.log('🎯 [DEBUG] Window producerClientMap before:', window.producerClientMap ? Array.from(window.producerClientMap.entries()) : 'undefined');
                console.groupEnd();
                console.log('🎯 New producer event:', data);
                if (data.producerId && data.clientID) {
                    if (!window.producerClientMap) window.producerClientMap = new Map();
                    window.producerClientMap.set(data.producerId, data.clientID);
                    console.log('💾 Saved producerId → clientID:', data.producerId, '→', data.clientID);
                }
                if (data.clientID !== this.clientID) {
                    console.log('🔹 Creating consumer for external producer');
                    await this.ensureConsumer(data.producerId, data);
                } else {
                    console.log('🔇 Ignoring own producer:', data.producerId);
                    this.consumerState.set(data.producerId, { status: 'active', consumer: null, lastError: null });
                }
                console.group('🔴🔴🔴 [DEBUG] AFTER PROCESSING new-producer');
                console.log('🎯 [DEBUG] Window producerClientMap after:', window.producerClientMap ? Array.from(window.producerClientMap.entries()) : 'undefined');
                console.groupEnd();
            });
            socket.on('current-producers', async (data) => {
                console.log('🎯 Current producers event:', data);
                if (!data || !data.producers || !Array.isArray(data.producers)) {
                    console.log('No producers data available');
                    return;
                }
                for (const producer of data.producers) {
                    if (producer.clientID !== this.clientID) {
                        await this.ensureConsumer(producer.id, producer);
                    } else {
                        this.consumerState.set(producer.id, { status: 'active', consumer: null, lastError: null });
                    }
                }
            });
            socket.on('room-participants', (participants) => {
                console.log('🎯 [CLIENT] Received room-participants event. Replacing entire members list.');
                const processedParticipants = participants.map(p => {
                    if (p.userId === this.userId) {
                        return { ...p, isOnline: true };
                    }  
                    return p;
                });
                MembersManager.updateAllMembers(processedParticipants);
                console.log('✅ [CLIENT] Members list fully replaced.');
                if (!window.voiceClient) {
                    window.voiceClient = {};
                }
                const me = processedParticipants.find(p => p.userId);
                if (me) {
                    window.voiceClient.userId = me.userId;
                    const displayName = me.username || me.name || me.userId;
                    if (typeof window.setLoggerDisplayName === 'function') {
                        window.setLoggerDisplayName(displayName);
                    }
                }
            });
            socket.on('user-joined', (user) => {
                console.log('User joined:', user);
                UIManager.addMessage('System', `Пользователь ${user.username} присоединился к комнате`);
                this.playSound('user-join');
            });
            socket.on('user-left', async (data) => {
                console.group('🔴🔴🔴 [DEBUG] SOCKET EVENT: user-left');
                console.log('🎯 [DEBUG] EVENT DATA RECEIVED:', JSON.stringify(data, null, 2));
                console.groupEnd();
                console.log('User left:', data.userId);
                const member = MembersManager.getMember(data.userId);
                const memberElement = document.querySelector(`.member-item[data-user-id="${data.userId}"]`);
                if (memberElement) {
                    const slider = memberElement.querySelector('.member-volume-slider');
                    if (slider) {
                        slider.style.display = 'none';
                        slider.dataset.producerId = '';
                        console.log('🔇 Volume slider hidden for user:', data.userId);
                    }
                    const statusIndicator = memberElement.querySelector('.status-indicator');
                    if (statusIndicator) {
                        statusIndicator.className = 'status-indicator offline';
                        statusIndicator.title = 'Offline';
                    }
                    const micIndicator = memberElement.querySelector('.mic-indicator');
                    if (micIndicator) {
                        micIndicator.className = 'mic-indicator';
                        micIndicator.title = 'Microphone muted';
                    }
                }
                if (member) {
                    member.isOnline = false;
                    UIManager.addMessage('System', `Пользователь ${member.username} покинул комнату`);
                } else {
                    UIManager.addMessage('System', `Пользователь покинул комнату`);
                }
                this.playSound('user-leave');
            });
            socket.on('user-mic-state', (data) => {
                console.log('User mic state changed:', data);
                if (data.userId) {
                    MembersManager.updateMember(data.userId, { isMicActive: data.isActive });
                } else {
                    const members = MembersManager.getMembers();
                    const member = members.find(m => m.clientId === data.clientID);
                    if (member) {
                        MembersManager.updateMember(member.userId, { isMicActive: data.isActive });
                    }
                }
            });
            socket.on('new-message', (message) => {
                console.log('New message received:', message);
                if (message.roomId === this.currentRoom) {
                    UIManager.addMessage(
                        message.username,
                        message.text,
                        message.timestamp,
                        message.type || 'text',
                        message.imageUrl,
                        message.id,
                        message.readBy || [],
                        message.userId // ← обязательно передаём userId
                    );
                    if (message.type !== 'image' && message.userId !== this.userId) {
                        this.playSound('message');
                    }
                }
            });
            socket.on('message-history', (data) => {
                console.log('Message history received:', data);
                if (data.roomId === this.currentRoom && data.messages) {
                    UIManager.clearMessages();
                    data.messages.forEach(msg => {
                        UIManager.addMessage(
                            msg.username,
                            msg.text,
                            msg.timestamp,
                            'text',
                            null,
                            msg.id,
                            msg.readBy || [],
                            msg.userId // ← обязательно передаём userId
                        );
                    });
                }
            });
            socket.on('error', (error) => {
                console.error('Socket error:', error);
                UIManager.showError('Ошибка соединения: ' + (error.message || 'неизвестная ошибка'));
            });
            socket.on('connect', () => {
                console.log('✅ Socket connected with ID:', socket.id);
                UIManager.updateStatus('Подключено', 'connected');
                if (this.currentRoom) {
                    console.log('Rejoining room after socket reconnect:', this.currentRoom);
                    socket.emit('join-room', { roomId: this.currentRoom });
                    socket.emit('subscribe-to-producers', { roomId: this.currentRoom });
                    socket.emit('get-current-producers', { roomId: this.currentRoom });
                }
            });
            socket.on('disconnect', (reason) => {
                console.log('Socket disconnected:', reason);
                UIManager.updateStatus('Отключено', 'disconnected');
            });
        } catch (error) {
            console.error('Error setting up socket connection:', error);
            UIManager.showError('Ошибка подключения к серверу');
        }
    }

    destroySocket() {
        console.log('Destroying socket connection...');
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }

    updateMicButtonState() {
        let status;
        if (!this.isConnected) {
            status = 'disconnected';
        } else if (this.isMicActive) {
            status = 'active';
        } else {
            status = 'connected';
        }
        UIManager.updateMicButton(status);
    }

    async toggleMicrophone(forceState = null) {
        console.log('Toggling microphone, current state:', this.isMicActive, 'PTT active:', this.isPTTActive);
        
        // 🚫 Если пытаемся выключить микрофон, но PTT активен - блокируем
        if (forceState === false && this.isPTTActive) {
            console.log('[PTT] Blocking mic disable - PTT is active');
            return;
        }

        try {
            if (!this.currentRoom) {
                UIManager.showError('Микрофон доступен только в комнатах');
                return;
            }

            const targetState = forceState !== null ? forceState : !this.isMicActive;

            if (targetState) {
                // Включение микрофона
                console.log('[PTT] Enabling microphone...');
                const enabled = await MediaManager.enableMicrophone(this);
                if (!enabled) {
                    if (!this.sendTransport && this.mediaData) {
                        await MediaManager.connect(this, this.currentRoom, this.mediaData);
                    }
                    await MediaManager.startMicrophone(this);
                }
                this.playSound('mic-on');
            } else {
                // Выключение микрофона
                console.log('[PTT] Disabling microphone...');
                const disabled = await MediaManager.disableMicrophone(this);
                if (!disabled) {
                    await MediaManager.stopMicrophone(this, false);
                }
                this.playSound('mic-off');
            }

            // Обновляем UI и рассылаем состояние
            UIManager.updateMemberMicState(this.userId, this.isMicActive);
            if (this.socket) {
                this.socket.emit('mic-state-change', {
                    roomId: this.currentRoom,
                    isActive: this.isMicActive,
                    clientID: this.clientID,
                    userId: this.userId
                });
            }

            this.updateMicButtonState();

        } catch (error) {
            console.error('Error toggling microphone:', error);
            UIManager.showError('Ошибка микрофона: ' + error.message);
            this.updateMicButtonState();
            throw error; // Пробрасываем ошибку выше для обработки в PTT
        }
    }

    sendMessage(text) {
        console.log('Sending message:', text);
        if (!text.trim()) return;
        if (!this.currentRoom) {
            this.showError('Вы не в комнате');
            return;
        }
        if (this.socket) {
            this.socket.emit('send-message', {
                roomId: this.currentRoom,
                text: text.trim()
            });
        } else {
            TextChatManager.sendMessage(this, text).catch((error) => {
                console.error('Error sending message:', error);
                this.showError('Ошибка отправки сообщения');
            });
        }
    }

    async startConsuming() {
        console.log('🔄 Starting media consumption...');
        if (!this.isConnected || !this.currentRoom) {
            console.log('Not connected or no room, skipping consumption');
            return;
        }
        try {
            const timestamp = Date.now();
            const response = await fetch(`${this.API_SERVER_URL}/api/media/rooms/${this.currentRoom}/producers?t=${timestamp}`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache'
                }
            });
            if (!response.ok) {
                console.error(`❌ HTTP error! status: ${response.status}`);
                return;
            }
            const data = await response.json();
            const producers = data.producers || [];
            console.log(`📋 Found ${producers.length} producers in room ${this.currentRoom}`);
            for (const producer of producers) {
                if (producer.clientID !== this.clientID) {
                    await this.ensureConsumer(producer.id, producer);
                } else {
                    this.consumerState.set(producer.id, { status: 'active', consumer: null, lastError: null });
                }
            }
        } catch (error) {
            console.error('❌ Error starting consuming:', error);
        }
    }

    async disconnectFromRoom() {
        console.log('Disconnecting from room:', this.currentRoom);
        if (this.currentRoom) {
            if (this.socket) {
                this.socket.emit('leave-room', { roomId: this.currentRoom });
            }
            MediaManager.disconnect(this);
            TextChatManager.leaveTextRoom(this, this.currentRoom);
            MembersManager.clearMembers();
            this.destroySocket();
            this.currentRoom = null;
            this.isConnected = false;
            this.isMicActive = false;
            this.consumerState.clear();
            this.updateMicButtonState();
        }
    }

    async reconnectToRoom(roomId) {
        console.log('Reconnecting to room:', roomId);
        try {
            UIManager.addMessage('System', 'Переподключение к комнате...');
            this.wasMicActiveBeforeReconnect = this.isMicActive;
            if (this.isMicActive && this.mediaData) {
                await MediaManager.stopMicrophone(this);
            }
            await this.leaveRoom();
            this.isReconnecting = true;
            await new Promise(resolve => setTimeout(resolve, 500));
            const result = await this.joinRoom(roomId);
            this.isReconnecting = false;
            if (this.wasMicActiveBeforeReconnect && this.mediaData) {
                setTimeout(async () => {
                    try {
                        await MediaManager.startMicrophone(this);
                        this.wasMicActiveBeforeReconnect = false;
                        setTimeout(() => {
                            this.forceRefreshProducers();
                        }, 2000);
                    } catch (error) {
                        console.error('Failed to restart microphone after reconnect:', error);
                        UIManager.showError('Не удалось восстановить микрофон после переподключения');
                    }
                }, 3000);
            }
            return result;
        } catch (error) {
            this.isReconnecting = false;
            UIManager.addMessage('System', 'Ошибка переподключения: ' + error.message);
            throw error;
        }
    }

    async leaveRoom() {
        console.log('Leaving room:', this.currentRoom);
        if (!this.currentRoom) return;
        try {
            if (this.socket) {
                this.socket.emit('leave-room', { roomId: this.currentRoom });
            }
            if (this.isConnected) {
                MediaManager.disconnect(this);
            }
            await fetch(`${this.API_SERVER_URL}/api/media/rooms/${this.currentRoom}/leave`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });
            document.querySelectorAll('.member-volume-slider').forEach(slider => {
                slider.style.display = 'none';
                slider.dataset.producerId = '';
                console.log('🔇 Volume slider cleared on room leave:', slider);
            });
            MembersManager.clearMembers();
            this.currentRoom = null;
            this.roomType = null;
            UIManager.updateRoomUI(this);
            UIManager.addMessage('System', `✅ Вы покинули комнату`);
            return true;
        } catch (error) {
            console.error('Error leaving room:', error);
            UIManager.showError('Ошибка при покидании комнаты: ' + error.message);
            return false;
        }
    }

    autoConnect() {
        console.log('Showing auto-connect UI');
        this.elements.sidebar.classList.add('open');
    }

    showMessage(user, text) {
        UIManager.addMessage(user, text);
    }

    showError(text) {
        UIManager.showError(text);
    }

    async searchServers(query) {
        console.log('Searching servers:', query);
        await ServerManager.searchServers(this, query);
    }

    async checkRoomState() {
        if (!this.currentRoom) {
            console.log('No current room to check');
            return;
        }
        try {
            const response = await fetch(`${this.API_SERVER_URL}/api/debug/room/${this.currentRoom}`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });
            if (response.ok) {
                const roomState = await response.json();
                console.log('🏠 Room state:', roomState);
                const ourTransport = roomState.transports.find(t => t.clientID === this.clientID && t.direction === 'recv');
                console.log('📡 Our receive transport:', ourTransport);
                const ourConsumers = roomState.consumers.filter(c => c.clientID === this.clientID);
                console.log('🎧 Our consumers:', ourConsumers);
                return roomState;
            } else {
                console.error('Failed to get room state:', response.status);
            }
        } catch (error) {
            console.error('Error checking room state:', error);
        }
    }

    async forceRefreshProducers() {
        try {
            console.log('🔄 Force refreshing producers...');
            const timestamp = Date.now();
            const response = await fetch(`${this.API_SERVER_URL}/api/media/rooms/${this.currentRoom}/producers/force?t=${timestamp}`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache'
                }
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            const producers = data.producers || [];
            console.log(`📋 Force refresh found ${producers.length} producers`);
            for (const producer of producers) {
                if (producer.clientID !== this.clientID && !this.existingProducers.has(producer.id)) {
                    try {
                        await MediaManager.createConsumer(this, producer.id);
                        this.existingProducers.add(producer.id);
                        console.log(`🎧 Created consumer for producer: ${producer.id}`);
                    } catch (error) {
                        console.error('❌ Error creating consumer:', error);
                        if (error.message.includes('consume own')) {
                            this.existingProducers.add(producer.id);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('❌ Error force refreshing producers:', error);
        }
    }

    // === PTT & BACK BUTTON LOGIC ===
    goBackToMain() {
        console.log('Going back to main addon manager...');
        if (window.electronAPI && typeof window.electronAPI.goBack === 'function') {
            window.electronAPI.goBack();
        } else {
            console.error('electronAPI.goBack is not available');
        }
    }

async showPTTSetupModal() {
  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';
  modalOverlay.style.display = 'flex';
  modalOverlay.innerHTML = `
    <div class="modal-content">
      <h2>Настройка Push-to-Talk</h2>
      <p>Нажмите нужную клавишу или кнопку мыши. Поддерживается только ОДНА клавиша или ОДНА кнопка мыши.</p>
      <div id="pttCaptureArea" style="
        width: 100%;
        height: 80px;
        border: 2px dashed #666;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 10px 0;
        font-size: 16px;
        color: #888;
        cursor: pointer;
      ">
        Нажмите клавишу или кнопку мыши...
      </div>
      <div id="capturedKeys" style="
        min-height: 24px;
        text-align: center;
        font-family: monospace;
        margin: 8px 0;
        color: #000;
      "></div>
      <div class="modal-buttons">
        <button id="confirmPTT">Сохранить</button>
        <button id="cancelPTT">Отмена</button>
      </div>
    </div>
  `;
  document.body.appendChild(modalOverlay);

  const captureArea = modalOverlay.querySelector('#pttCaptureArea');
  const capturedKeysEl = modalOverlay.querySelector('#capturedKeys');
  let capturedCode = null;

  const keyDownHandler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Получаем физический scancode (не e.code!)
    // Но в браузере мы не можем получить настоящий scancode → временно запрещаем настройку через UI
    capturedKeysEl.textContent = '⚠️ Настройка PTT через UI отключена. Используйте клавиши в settings.json.';
    capturedCode = null;
  };

  const mouseDownHandler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    capturedKeysEl.textContent = '⚠️ Настройка PTT через UI отключена. Используйте клавиши в settings.json.';
    capturedCode = null;
  };

  captureArea.addEventListener('keydown', keyDownHandler, true);
  captureArea.addEventListener('mousedown', mouseDownHandler, true);
  captureArea.focus();

  const cleanup = () => {
    captureArea.removeEventListener('keydown', keyDownHandler, true);
    captureArea.removeEventListener('mousedown', mouseDownHandler, true);
  };

  modalOverlay.querySelector('#confirmPTT').addEventListener('click', async () => {
    // Временно: не даём сохранять через UI
    UIManager.showError('Настройка PTT через интерфейс отключена. Отредактируйте settings.json вручную.');
    cleanup();
    modalOverlay.remove();
  });

  modalOverlay.querySelector('#cancelPTT').addEventListener('click', () => {
    cleanup();
    modalOverlay.remove();
  });

  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
      cleanup();
      modalOverlay.remove();
    }
  });
}

    getKeyString(e) {
        let key = '';
        if (e.ctrlKey) key += 'Ctrl+';
        if (e.altKey) key += 'Alt+';
        if (e.shiftKey) key += 'Shift+';
        if (e.metaKey) key += 'Command+';
        const code = e.code.replace('Key', '').replace('Digit', '');
        if (code && !['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight'].includes(e.code)) {
            key += code;
        }
        return key || null;
    }

    async handlePTTPressed(isDown) {
  if (!this.currentRoom) return;
  if (isDown) {
    if (!this.isMicActive) {
      try {
        await this.toggleMicrophone(true);
      } catch (e) {
        console.error('[PTT] Mic enable failed:', e);
      }
    }
  } else {
    if (this.isMicActive) {
      try {
        await this.toggleMicrophone(false);
      } catch (e) {
        console.error('[PTT] Mic disable failed:', e);
      }
    }
  }
}
}

window.debugForceRefresh = () => {
    if (window.debugVoiceClient) {
        window.debugVoiceClient.forceRefreshProducers();
    } else {
        console.error('Voice client not available for debugging');
    }
};

export default VoiceChatClient;