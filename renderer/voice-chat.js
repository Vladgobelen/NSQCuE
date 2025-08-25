// voice-chat.js
class VoiceChatClient {
    constructor() {
        console.log('[CONSTRUCTOR] Начало инициализации VoiceChatClient');
        this.SERVER_URL = 'http://194.31.171.29:38592';
        this.clientID = this.generateClientID();
        console.log('[CONSTRUCTOR] Сгенерирован clientID:', this.clientID);
        this.sendTransport = null;
        this.recvTransport = null;
        this.audioProducer = null;
        this.consumers = new Map();
        this.stream = null;
        this.isMicActive = false;
        this.isConnected = false;
        this.isConnectionInProgress = false;
        this.device = null;
        this.currentRoom = 'general';
        this.keepAliveInterval = null;
        this.updateInterval = null;
        // === ДОБАВЛЕНО: Настройки качества звука ===
        this.bitrate = 32000; // По умолчанию 32 кбит/с
        this.dtxEnabled = true; // По умолчанию DTX включен
        this.fecEnabled = true;  // По умолчанию FEC включен
        // === КОНЕЦ ДОБАВЛЕНИЯ ===
        window.voiceChatClient = this;
        // Элементы UI
        console.log('[CONSTRUCTOR] Получение элементов UI');
        this.micButton = document.getElementById('micButton');
        this.micButtonText = document.getElementById('micButtonText');
        this.statusText = document.getElementById('statusText');
        this.statusIndicator = document.getElementById('statusIndicator');
        this.membersList = document.getElementById('membersList');
        this.membersCount = document.getElementById('membersCount');
        this.messagesContainer = document.getElementById('messagesContainer');
        this.messageInput = document.getElementById('messageInput');
        this.systemTime = document.getElementById('systemTime');
        this.selfStatus = document.getElementById('selfStatus');
        this.roomItems = document.querySelectorAll('.room-item');
        this.currentRoomTitle = document.getElementById('currentRoomTitle');
        this.backBtn = document.getElementById('backBtn');
        this.sidebarBackBtn = document.querySelector('.sidebar-header .back-btn');
        this.compactMicBtn = document.getElementById('compactMicBtn');
        // === ДОБАВЛЕНО: Элементы модального окна настроек ===
        this.settingsModal = document.getElementById('settingsModal');
        this.openSettingsBtn = document.getElementById('openSettingsBtn');
        this.closeSettingsModal = document.getElementById('closeSettingsModal');
        this.bitrateSlider = document.getElementById('bitrateSlider');
        this.bitrateValue = document.getElementById('bitrateValue');
        this.dtxCheckbox = document.getElementById('dtxCheckbox');
        this.fecCheckbox = document.getElementById('fecCheckbox');
        this.applySettingsBtn = document.getElementById('applySettingsBtn');
        // === КОНЕЦ ДОБАВЛЕНИЯ ===
        console.log('[CONSTRUCTOR] Проверка наличия mediasoupClient');
        if (typeof mediasoupClient === 'undefined') {
            console.error('[CONSTRUCTOR] mediasoupClient не найден');
            this.updateStatus('Ошибка: mediasoup-client не загружен', 'disconnected');
            this.micButton.disabled = true;
            this.micButtonText.textContent = 'Ошибка инициализации';
            if (this.compactMicBtn) this.compactMicBtn.style.display = 'none';
            this.addMessage('System', 'Не удалось загрузить необходимые компоненты. Проверьте подключение к интернету.');
            return;
        }
        // Обновление времени
        console.log('[CONSTRUCTOR] Настройка обновления времени');
        this.updateSystemTime();
        setInterval(() => this.updateSystemTime(), 60000);
        // Обработчики событий
        console.log('[CONSTRUCTOR] Настройка обработчиков событий');
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });
        // Обработчики для комнат
        this.roomItems.forEach(item => {
            item.addEventListener('click', () => {
                this.roomItems.forEach(r => r.classList.remove('active'));
                item.classList.add('active');
                this.currentRoom = item.dataset.room;
                const roomName = this.getRoomName(this.currentRoom);
                this.currentRoomTitle.textContent = roomName;
                this.addMessage('System', `Вы вошли в комнату: ${roomName}`);
            });
        });
        // Используем стрелочную функцию или bind для сохранения контекста 'this'
        const handleBackClick = () => {
            console.log('[BACK] Нажата кнопка "Назад"');
            this.hideUI();
        };
        if (this.backBtn) {
            this.backBtn.addEventListener('click', handleBackClick);
        }
        if (this.sidebarBackBtn) {
            this.sidebarBackBtn.addEventListener('click', handleBackClick);
        }
        // === ИЗМЕНЕНО: Обработчики событий для модального окна настроек ===
        // Перенесено сюда из отдельного script тега в index.html для корректной работы this
        if (this.openSettingsBtn) {
            this.openSettingsBtn.addEventListener('click', () => this.openSettings());
        }
        // Добавляем обработчик для кнопки настроек в заголовке чата (для компактного режима)
        // Теперь он находится в правильном контексте (this)
        const chatOpenSettingsBtn = document.getElementById('chatOpenSettingsBtn');
        if (chatOpenSettingsBtn) {
             chatOpenSettingsBtn.addEventListener('click', () => this.openSettings());
        }
        if (this.closeSettingsModal) {
            this.closeSettingsModal.addEventListener('click', () => {
                if (this.settingsModal) this.settingsModal.style.display = 'none';
            });
        }
        if (this.bitrateSlider) {
            this.bitrateSlider.addEventListener('input', () => {
                if (this.bitrateValue) this.bitrateValue.textContent = this.bitrateSlider.value;
            });
        }
        if (this.applySettingsBtn) {
            this.applySettingsBtn.addEventListener('click', () => this.applySettings());
        }
        // Закрытие модального окна при клике вне его
        window.addEventListener('click', (event) => {
            if (this.settingsModal && event.target === this.settingsModal) {
                this.settingsModal.style.display = 'none';
            }
        });
        // === КОНЕЦ ИЗМЕНЕНИЯ ===
        // Инициализация
        console.log('[CONSTRUCTOR] Вызов setupInitialUI');
        this.setupInitialUI();
        console.log('[CONSTRUCTOR] Инициализация завершена');
    }
    getRoomName(roomId) {
        const rooms = {
            'general': 'Общий голосовой канал',
            'music': 'Музыкальная комната',
            'conference': 'Конференция'
        };
        return rooms[roomId] || roomId;
    }
    setupInitialUI() {
        console.log('[UI] Настройка начального UI');
        if (this.micButton) {
            this.micButton.disabled = true;
            this.micButtonText.textContent = 'Подключение...';
            this.micButton.onclick = null;
        }
        if (this.compactMicBtn) {
             this.compactMicBtn.disabled = true;
             this.compactMicBtn.onclick = null;
        }
        this.updateStatus('Инициализация...', 'connecting');
        console.log('[UI] Начальный UI настроен');
    }
    generateClientID() {
        return 'user_' + Math.random().toString(36).substr(2, 9);
    }
    updateStatus(message, type = 'normal') {
        console.log(`[STATUS] ${message} (type: ${type})`);
        if (this.statusText) this.statusText.textContent = message;
        if (this.statusIndicator) {
            this.statusIndicator.className = 'status-indicator';
            if (type === 'connecting') {
                this.statusIndicator.classList.add('connecting');
            } else if (type === 'disconnected') {
                this.statusIndicator.classList.add('disconnected');
            }
        }
    }
    updateSystemTime() {
        const now = new Date();
        if (this.systemTime) {
            this.systemTime.textContent = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        }
    }
    addMessage(username, text, time = null) {
        if (!this.messagesContainer) return; // Добавлена проверка
        const now = new Date();
        const timeString = time || `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        const messageElement = document.createElement('div');
        messageElement.className = 'message new-message';
        const avatarText = username === 'Вы' ? 'Вы' : username.charAt(0).toUpperCase();
        messageElement.innerHTML = `
            <div class="message-avatar">${avatarText}</div>
            <div class="message-content">
                <div class="message-header">
                    <div class="message-username">${username}</div>
                    <div class="message-time">${timeString}</div>
                </div>
                <div class="message-text">${text}</div>
            </div>
        `;
        this.messagesContainer.appendChild(messageElement);
        setTimeout(() => {
            messageElement.classList.add('appeared');
        }, 10);
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }
    sendMessage() {
        if (!this.messageInput) return; // Добавлена проверка
        const message = this.messageInput.value.trim();
        if (message) {
            this.addMessage('Вы', message);
            this.messageInput.value = '';
            // this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight; // Уже в addMessage
        }
    }
    async ensureStream() {
        console.log('[STREAM] Проверка и обеспечение потока');
        const audioTracks = this.stream ? this.stream.getAudioTracks() : [];
        const hasActiveTrack = audioTracks.length > 0 && audioTracks[0].readyState === 'live';
        if (!hasActiveTrack) {
            console.log('[STREAM] Требуется новый поток');
            this.updateStatus('Получение доступа к микрофону...', 'connecting');
            this.stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    echoCancellationType: 'system'
                },
                video: false
            });
            console.log('[STREAM] Новый поток получен');
        } else {
            console.log('[STREAM] Активный поток уже существует');
        }
    }
    async connectToServer() {
        console.log('[CONNECT] Начало подключения к серверу');
        if (this.isConnected) {
            console.log('[CONNECT] Уже подключен, переключаем микрофон');
            await this.toggleMicrophone();
            return;
        }
        if (this.isConnectionInProgress) {
             console.log('[CONNECT] Подключение уже в процессе');
             return;
        }
        this.isConnectionInProgress = true;
        try {
            this.updateStatus('Подключение к серверу...', 'connecting');
            if (this.micButton) {
                this.micButtonText.textContent = 'Подключение...';
                this.micButton.disabled = true;
            }
            if (this.compactMicBtn) {
                 this.compactMicBtn.disabled = true;
                 this.compactMicBtn.classList.remove('active');
            }
            console.log('[CONNECT] Регистрация клиента');
            this.updateStatus('Регистрация клиента...', 'connecting');
            await this.registerClient();
            console.log('[CONNECT] Клиент зарегистрирован');
            this.startKeepAlive();
            console.log('[CONNECT] Получение RTP возможностей');
            this.updateStatus('Загрузка возможностей...', 'connecting');
            const rtpCapabilities = await this.getRtpCapabilities();
            console.log('[CONNECT] RTP возможности получены:', rtpCapabilities ? 'OK' : 'NULL');
            console.log('[CONNECT] Создание устройства mediasoup');
            this.device = new mediasoupClient.Device();
            console.log('[CONNECT] Устройство создано, загрузка возможностей');
            await this.device.load({ routerRtpCapabilities: rtpCapabilities });
            console.log('[CONNECT] Устройство загружено');
            console.log('[CONNECT] Создание транспортов');
            this.updateStatus('Создание транспортов...', 'connecting');
            await this.createTransports();
            console.log('[CONNECT] Транспорты созданы');
            this.isConnected = true;
            this.isConnectionInProgress = false;
            this.updateStatus('Подключено к серверу', 'normal');
            if (this.micButton) {
                this.micButton.disabled = false;
                this.micButtonText.textContent = 'Включить микрофон';
            }
            if (this.compactMicBtn) {
                 this.compactMicBtn.disabled = false;
                 this.compactMicBtn.title = 'Включить/выключить микрофон';
            }
            const toggleMicHandler = () => {
                console.log('[MIC] Нажата кнопка микрофона');
                this.toggleMicrophone();
            };
            if (this.micButton) this.micButton.onclick = toggleMicHandler;
            if (this.compactMicBtn) this.compactMicBtn.onclick = toggleMicHandler;
            console.log('[CONNECT] Запуск обновления участников');
            this.startParticipantUpdates();
            this.addMessage('System', 'Успешно подключено к серверу! Теперь вы можете включить микрофон.');
            console.log('[CONNECT] Подключение завершено успешно');
        } catch (error) {
            console.error('[CONNECT ERROR]', error);
            this.isConnectionInProgress = false;
            let errorMessage = error.message || 'Неизвестная ошибка';
            if (error.name === 'NotAllowedError') {
                errorMessage = 'Доступ к микрофону запрещен. Проверьте разрешения браузера.';
            } else if (error.name === 'NotFoundError') {
                errorMessage = 'Микрофон не найден. Проверьте подключение микрофона.';
            } else if (error.name === 'NotReadableError') {
                errorMessage = 'Микрофон занят другим приложением.';
            } else if (error.name === 'SecurityError') {
                errorMessage = 'Безопасность: запрос на микрофон должен быть инициирован действием пользователя.';
            }
            this.updateStatus('Ошибка: ' + errorMessage, 'disconnected');
            if (this.micButton) {
                this.micButton.disabled = false;
                this.micButtonText.textContent = 'Ошибка подключения';
            }
            if (this.compactMicBtn) {
                 this.compactMicBtn.disabled = false;
                 this.compactMicBtn.title = 'Ошибка подключения';
            }
            this.addMessage('System', 'Ошибка подключения: ' + errorMessage);
            setTimeout(() => {
                 if (!this.isConnected && this.micButton) {
                    console.log('[CONNECT] Сброс кнопки после ошибки');
                    this.micButtonText.textContent = 'Включить микрофон';
                    const retryHandler = () => {
                        console.log('[UI] Нажата кнопка повторного подключения');
                        this.connectToServer();
                    };
                    this.micButton.onclick = retryHandler;
                    if (this.compactMicBtn) {
                         this.compactMicBtn.onclick = retryHandler;
                         this.compactMicBtn.title = 'Повторить подключение';
                    }
                }
            }, 3000);
        }
    }
    async registerClient() {
        console.log('[REGISTER] Регистрация клиента');
        try {
            const response = await fetch(`${this.SERVER_URL}/api/client/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientID: this.clientID })
            });
            console.log('[REGISTER] Ответ сервера:', response.status);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error('[REGISTER] Ошибка сервера:', errorData);
                throw new Error(`HTTP error! status: ${response.status} ${errorData.message || ''}`);
            }
            const data = await response.json();
            console.log('[REGISTER] Регистрация успешна');
            return data;
        } catch (error) {
            console.error('[REGISTER ERROR]', error);
            throw new Error('Не удалось зарегистрировать клиента: ' + error.message);
        }
    }
    startKeepAlive() {
        console.log('[KEEPALIVE] Запуск keep-alive');
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
        }
        this.keepAliveInterval = setInterval(async () => {
            try {
                await this.registerClient();
            } catch (error) {
                console.log('[KEEP-ALIVE ERROR]', error);
            }
        }, 5000);
    }
    async getRtpCapabilities() {
        console.log('[RTP] Получение RTP возможностей');
        try {
            const response = await fetch(`${this.SERVER_URL}/api/rtp-capabilities`);
            console.log('[RTP] Ответ сервера:', response.status);
            if (!response.ok) {
                console.error('[RTP] Ошибка сервера: status', response.status);
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            console.log('[RTP] RTP возможности получены, длина данных:', data ? Object.keys(data).length : 0);
            return data;
        } catch (error) {
            console.error('[RTP CAPABILITIES ERROR]', error);
            throw new Error('Не удалось получить RTP возможности: ' + error.message);
        }
    }
    async createTransports() {
        console.log('[TRANSPORTS] Создание транспортов');
        try {
            console.log('[TRANSPORTS] Создание send транспорта');
            const sendTransportData = await this.createTransport('send');
            console.log('[TRANSPORTS] Send транспорт создан:', sendTransportData ? 'OK' : 'NULL');
            console.log('[TRANSPORTS] Создание sendTransport объекта');
            this.sendTransport = this.device.createSendTransport({
                id: sendTransportData.transportId,
                iceParameters: sendTransportData.iceParameters,
                iceCandidates: sendTransportData.iceCandidates,
                dtlsParameters: sendTransportData.dtlsParameters
            });
            console.log('[TRANSPORTS] SendTransport объект создан');
            this.setupSendTransport();
            console.log('[TRANSPORTS] Создание recv транспорта');
            const recvTransportData = await this.createTransport('recv');
            console.log('[TRANSPORTS] Recv транспорт создан:', recvTransportData ? 'OK' : 'NULL');
            console.log('[TRANSPORTS] Создание recvTransport объекта');
            this.recvTransport = this.device.createRecvTransport({
                id: recvTransportData.transportId,
                iceParameters: recvTransportData.iceParameters,
                iceCandidates: recvTransportData.iceCandidates,
                dtlsParameters: recvTransportData.dtlsParameters
            });
            console.log('[TRANSPORTS] RecvTransport объект создан');
            this.setupRecvTransport();
            console.log('[TRANSPORTS] Все транспорты созданы');
        } catch (error) {
            console.error('[TRANSPORTS ERROR]', error);
            throw new Error('Не удалось создать транспорты: ' + error.message);
        }
    }
    async createTransport(direction) {
        console.log(`[TRANSPORT] Создание транспорта (${direction})`);
        try {
            const response = await fetch(`${this.SERVER_URL}/api/transport/create`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Client-ID': this.clientID
                },
                body: JSON.stringify({
                    clientID: this.clientID,
                    direction: direction
                })
            });
            console.log(`[TRANSPORT] Ответ сервера (${direction}):`, response.status);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error(`[TRANSPORT] Ошибка сервера (${direction}):`, errorData);
                throw new Error(`HTTP error! status: ${response.status} ${errorData.message || ''}`);
            }
            const data = await response.json();
            console.log(`[TRANSPORT] Транспорт (${direction}) создан, ID:`, data.transportId);
            return data;
        } catch (error) {
            console.error(`[CREATE TRANSPORT ERROR] (${direction})`, error);
            throw new Error(`Не удалось создать транспорт (${direction}): ` + error.message);
        }
    }
    setupSendTransport() {
        console.log('[SEND TRANSPORT] Настройка send транспорта');
        if (!this.sendTransport) return; // Добавлена проверка
        this.sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            console.log('[SEND TRANSPORT] Событие connect');
            try {
                const response = await fetch(`${this.SERVER_URL}/api/transport/connect`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Client-ID': this.clientID
                    },
                    body: JSON.stringify({
                        transportId: this.sendTransport.id,
                        dtlsParameters
                    })
                });
                console.log('[SEND TRANSPORT] Connect ответ:', response.status);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                console.log('[SEND TRANSPORT] Connect успешен');
                callback();
            } catch (error) {
                console.error('[SEND TRANSPORT CONNECT ERROR]', error);
                errback(error);
            }
        });
        this.sendTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
            console.log('[SEND TRANSPORT] Событие produce');
            try {
                const response = await fetch(`${this.SERVER_URL}/api/produce`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Client-ID': this.clientID
                    },
                    body: JSON.stringify({
                        transportId: this.sendTransport.id,
                        kind,
                        rtpParameters
                    })
                });
                console.log('[SEND TRANSPORT] Produce ответ:', response.status);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json();
                console.log('[SEND TRANSPORT] Produce успешен, producerId:', data.producerId);
                callback({ id: data.producerId });
            } catch (error) {
                console.error('[PRODUCE ERROR]', error);
                errback(error);
            }
        });
        console.log('[SEND TRANSPORT] Send транспорт настроен');
    }
    setupRecvTransport() {
        console.log('[RECV TRANSPORT] Настройка recv транспорта');
        if (!this.recvTransport) return; // Добавлена проверка
        this.recvTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            console.log('[RECV TRANSPORT] Событие connect');
            try {
                const response = await fetch(`${this.SERVER_URL}/api/transport/connect`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Client-ID': this.clientID
                    },
                    body: JSON.stringify({
                        transportId: this.recvTransport.id,
                        dtlsParameters
                    })
                });
                console.log('[RECV TRANSPORT] Connect ответ:', response.status);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                console.log('[RECV TRANSPORT] Connect успешен');
                callback();
            } catch (error) {
                console.error('[RECV TRANSPORT CONNECT ERROR]', error);
                errback(error);
            }
        });
        console.log('[RECV TRANSPORT] Recv транспорт настроен');
    }
    async toggleMicrophone() {
        console.log('[MIC] Переключение микрофона, текущее состояние:', this.isMicActive);
        if (this.isMicActive) {
            await this.stopMicrophone();
        } else {
            await this.startMicrophone();
        }
    }
    async startMicrophone() {
        console.log('[MIC] Включение микрофона');
        try {
            await this.ensureStream();
            const audioTrack = this.stream.getAudioTracks()[0];
            console.log('[MIC] Получен аудио трек');
            // === ИЗМЕНЕНО: Передаем параметры кодирования в produce ===
            const encodings = [
                {
                    maxBitrate: this.bitrate, // Используем значение из настроек
                    dtx: this.dtxEnabled,     // Используем значение из настроек
                    fec: this.fecEnabled      // Используем значение из настроек
                }
            ];
            if (!this.sendTransport) {
                throw new Error("Send transport не инициализирован");
            }
            this.audioProducer = await this.sendTransport.produce({
                track: audioTrack,
                encodings: encodings // <-- Передаем параметры
            });
            // === КОНЕЦ ИЗМЕНЕНИЯ ===
            console.log('[MIC] Producer создан');
            this.isMicActive = true;
            if (this.micButton) {
                this.micButton.classList.add('active');
                this.micButtonText.textContent = 'Выключить микрофон';
            }
            if (this.compactMicBtn) {
                 this.compactMicBtn.classList.add('active');
                 this.compactMicBtn.title = 'Выключить микрофон';
            }
            if (this.selfStatus) {
                this.selfStatus.className = 'member-status active';
            }
            this.updateStatus('Микрофон включен - вас слышат!', 'normal');
            // --- Исправлено: Используем конкатенацию вместо шаблонной строки для битрейта ---
            const bitrateKbps = this.bitrate / 1000;
            const dtxStatus = this.dtxEnabled ? 'вкл' : 'выкл';
            const fecStatus = this.fecEnabled ? 'вкл' : 'выкл';
            this.addMessage('System', 'Микрофон включен - вас слышат! (Битрейт: ' + bitrateKbps + ' кбит/с, DTX: ' + dtxStatus + ', FEC: ' + fecStatus + ')');
            // --- Конец исправления ---
            console.log('[MIC] Микрофон включен');
        } catch (error) {
            console.error('[MIC START ERROR]', error);
            this.updateStatus('Ошибка включения микрофона: ' + error.message, 'disconnected');
            this.addMessage('System', 'Ошибка включения микрофона: ' + error.message);
            if (this.micButton) {
                this.micButton.classList.remove('active');
                this.micButtonText.textContent = 'Включить микрофон';
            }
            if (this.compactMicBtn) {
                 this.compactMicBtn.classList.remove('active');
                 this.compactMicBtn.title = 'Включить микрофон';
            }
        }
    }
    async stopMicrophone() {
        console.log('[MIC] Выключение микрофона');
        try {
            if (this.audioProducer) {
                console.log('[MIC] Закрытие producer');
                const response = await fetch(`${this.SERVER_URL}/api/producer/close`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Client-ID': this.clientID
                    },
                    body: JSON.stringify({ producerId: this.audioProducer.id })
                });
                console.log('[MIC] Ответ на закрытие producer:', response.status);
                this.audioProducer.close();
                this.audioProducer = null;
            }
            if (this.stream) {
                console.log('[MIC] Остановка треков потока');
                this.stream.getAudioTracks().forEach(track => {
                     console.log('[MIC] Остановка трека:', track.id, track.readyState);
                     track.stop();
                });
                this.stream = null;
            }
            this.isMicActive = false;
            if (this.micButton) {
                this.micButton.classList.remove('active');
                this.micButtonText.textContent = 'Включить микрофон';
            }
            if (this.compactMicBtn) {
                 this.compactMicBtn.classList.remove('active');
                 this.compactMicBtn.title = 'Включить микрофон';
            }
            if (this.selfStatus) {
                this.selfStatus.className = 'member-status muted';
            }
            this.updateStatus('Микрофон выключен - вы только слушаете', 'normal');
            this.addMessage('System', 'Микрофон выключен - вы только слушаете');
            console.log('[MIC] Микрофон выключен');
        } catch (error) {
            console.error('[MIC STOP ERROR]', error);
            this.updateStatus('Ошибка выключения микрофона: ' + error.message, 'disconnected');
        }
    }
    async updateParticipants() {
        try {
            const response = await fetch(`${this.SERVER_URL}/api/clients?clientID=${this.clientID}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            this.updateMembersList(data.clients);
            const otherClients = data.clients.filter(clientId => clientId !== this.clientID);
            for (const clientId of otherClients) {
                await this.consumeClientProducers(clientId);
            }
        } catch (error) {
            console.error('[PARTICIPANTS ERROR]', error);
        }
    }
    updateMembersList(clients) {
        if (!this.membersList || !this.membersCount) return; // Добавлена проверка
        const otherClients = clients.filter(clientId => clientId !== this.clientID);
        this.membersCount.textContent = otherClients.length + 1;
        let membersHTML = `
            <div class="member-item">
                <div class="member-avatar">Вы</div>
                <div class="member-name">Вы</div>
                <div class="member-status ${this.isMicActive ? 'active' : 'muted'}" id="selfStatus"></div>
            </div>
        `;
        otherClients.forEach(clientId => {
            const shortId = clientId.substring(0, 6);
            const firstChar = shortId.charAt(0).toUpperCase();
            // Исправлено: закрывающий тег </div> для member-name
            membersHTML += `
                <div class="member-item">
                    <div class="member-avatar">${firstChar}</div>
                    <div class="member-name">${shortId}</div>
                    <div class="member-status"></div>
                </div>
            `;
        });
        this.membersList.innerHTML = membersHTML;
        // Обновляем ссылку на selfStatus после innerHTML
        this.selfStatus = document.getElementById('selfStatus');
    }
    async consumeClientProducers(clientId) {
        try {
            if (clientId === this.clientID) {
                return;
            }
            const response = await fetch(`${this.SERVER_URL}/api/client/${clientId}/producers`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            for (const producerId of data.producers) {
                if (!this.consumers.has(producerId)) {
                    await this.consumeProducer(producerId, clientId);
                }
            }
        } catch (error) {
            console.error('[CONSUME CLIENT ERROR]', error);
        }
    }
    async consumeProducer(producerId, clientId) {
        try {
            if (clientId === this.clientID || !this.recvTransport || !this.device) {
                return;
            }
            const response = await fetch(`${this.SERVER_URL}/api/consume`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Client-ID': this.clientID
                },
                body: JSON.stringify({
                    producerId: producerId,
                    rtpCapabilities: this.device.rtpCapabilities,
                    transportId: this.recvTransport.id
                })
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`HTTP error! status: ${response.status} ${errorData.message || ''}`);
            }
            const data = await response.json();
            if (data.error) {
                throw new Error(data.error);
            }
            const consumer = await this.recvTransport.consume({
                id: data.consumerId,
                producerId: data.producerId,
                kind: data.kind,
                rtpParameters: data.rtpParameters
            });
            this.consumers.set(producerId, consumer);
            this.playAudio(consumer.track, clientId, producerId);
        } catch (error) {
            console.error('[CONSUME PRODUCER ERROR]', error);
        }
    }
    playAudio(track, clientId, producerId) {
        try {
            const mediaStream = new MediaStream([track.clone()]);
            const audioElement = document.createElement('audio');
            audioElement.srcObject = mediaStream;
            audioElement.volume = 0.8;
            audioElement.style.display = 'none';
            document.body.appendChild(audioElement);
            setTimeout(() => {
                const playPromise = audioElement.play();
                if (playPromise !== undefined) {
                    playPromise
                        .then(() => {
                        })
                        .catch(error => {
                            console.log('[AUDIO] Ошибка воспроизведения для:', clientId, error);
                            audioElement.muted = true;
                            audioElement.play().then(() => {
                                audioElement.muted = false;
                            }).catch(e => {
                                console.error('[AUDIO] Финальная ошибка воспроизведения:', e);
                            });
                        });
                }
            }, 100);
            if (!window.audioElements) window.audioElements = new Map();
            window.audioElements.set(producerId, audioElement);
        } catch (error) {
            console.error('[AUDIO ERROR]', error);
        }
    }
    async startParticipantUpdates() {
        console.log('[PARTICIPANTS] Запуск обновления участников');
        await this.updateParticipants();
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        this.updateInterval = setInterval(async () => {
            await this.updateParticipants();
        }, 3000);
    }
    // === ДОБАВЛЕНО: Методы для работы с настройками ===
    openSettings() {
        if (!this.settingsModal || !this.bitrateSlider || !this.bitrateValue || !this.dtxCheckbox || !this.fecCheckbox) return; // Добавлена проверка
        // Заполняем поля модального окна текущими значениями
        this.bitrateSlider.value = this.bitrate / 1000; // Переводим в кбит/с для слайдера
        this.bitrateValue.textContent = this.bitrateSlider.value;
        this.dtxCheckbox.checked = this.dtxEnabled;
        this.fecCheckbox.checked = this.fecEnabled;
        this.settingsModal.style.display = 'block';
    }
    async applySettings() {
        if (!this.bitrateSlider || !this.dtxCheckbox || !this.fecCheckbox || !this.settingsModal) return; // Добавлена проверка
        const newBitrate = parseInt(this.bitrateSlider.value) * 1000; // Переводим обратно в бит/с
        const newDtx = this.dtxCheckbox.checked;
        const newFec = this.fecCheckbox.checked;
        const bitrateChanged = newBitrate !== this.bitrate;
        const dtxChanged = newDtx !== this.dtxEnabled;
        const fecChanged = newFec !== this.fecEnabled;
        if (bitrateChanged || dtxChanged || fecChanged) {
            this.bitrate = newBitrate;
            this.dtxEnabled = newDtx;
            this.fecEnabled = newFec;
            const bitrateKbps = this.bitrate / 1000;
            const dtxStatus = this.dtxEnabled ? 'вкл' : 'выкл';
            const fecStatus = this.fecEnabled ? 'вкл' : 'выкл';
            this.addMessage('System', 'Настройки обновлены: Битрейт ' + bitrateKbps + ' кбит/с, DTX ' + dtxStatus + ', FEC ' + fecStatus);
            // Если микрофон активен, перезапускаем его с новыми настройками
            if (this.isMicActive) {
                 await this.updateProducerSettings();
            }
        }
        this.settingsModal.style.display = 'none';
    }
    async updateProducerSettings() {
        // Останавливаем текущий микрофон
        await this.stopMicrophone();
        // Запускаем микрофон заново с новыми настройками
        await this.startMicrophone();
        this.addMessage('System', 'Настройки применены. Микрофон перезапущен.');
    }
    // === КОНЕЦ ДОБАВЛЕНИЯ ===
    hideUI() {
        console.log('[UI] Скрытие интерфейса голосового чата');
        try {
            const appContainer = document.querySelector('.app');
            const statusBar = document.querySelector('.status-bar');
            if (appContainer) {
                appContainer.style.display = 'none';
            } else {
                 console.warn('[UI] Контейнер .app не найден для скрытия.');
            }
            if (statusBar) {
                 statusBar.style.display = 'none';
            } else {
                 console.warn('[UI] Контейнер .status-bar не найден для скрытия.');
            }
            // Исправлено: Проверяем, что window.parent отличен от window
            if (window.parent && window.parent !== window) {
                console.log('[UI] Отправка сообщения родителю для закрытия голосового чата.');
                window.parent.postMessage({ type: 'CLOSE_VOICE_CHAT' }, '*');
            } else {
                console.warn('[UI] window.parent не доступен или это окно верхнего уровня. Не удалось отправить сообщение для закрытия.');
                if (window.electronAPI && typeof window.electronAPI.goBack === 'function') {
                    console.log('[UI] Вызов electronAPI.goBack как резервный вариант.');
                    window.electronAPI.goBack();
                } else {
                     console.warn('[UI] Резервный вариант electronAPI.goBack также недоступен.');
                     // Дополнительная попытка скрыть UI, если другие методы не работают
                     if (appContainer) appContainer.style.display = 'none';
                     if (statusBar) statusBar.style.display = 'none';
                }
            }
            console.log('[UI] Интерфейс голосового чата скрыт, сообщение отправлено.');
        } catch (error) {
           console.error('[UI] Ошибка при скрытии интерфейса:', error);
        }
    }
    showUI() {
        console.log('[UI] Показ интерфейса голосового чата');
        try {
            const appContainer = document.querySelector('.app');
            const statusBar = document.querySelector('.status-bar');
            if (appContainer) {
                appContainer.style.display = '';
            } else {
                 console.warn('[UI] Контейнер .app не найден для показа.');
            }
            if (statusBar) {
                 statusBar.style.display = '';
            } else {
                 console.warn('[UI] Контейнер .status-bar не найден для показа.');
            }
            console.log('[UI] Интерфейс голосового чата показан.');
        } catch (error) {
           console.error('[UI] Ошибка при показе интерфейса:', error);
        }
    }
    destroy() {
        console.log('[DESTROY] Начало очистки ресурсов');
        this.hideUI();
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        if (this.audioProducer) {
            this.audioProducer.close();
            this.audioProducer = null;
        }
        this.consumers.forEach(consumer => {
            if (consumer && typeof consumer.close === 'function') {
                consumer.close();
            }
        });
        this.consumers.clear();
        if (this.sendTransport) {
            this.sendTransport.close();
            this.sendTransport = null;
        }
        if (this.recvTransport) {
            this.recvTransport.close();
            this.recvTransport = null;
        }
        if (this.stream) {
            const tracks = this.stream.getTracks();
            tracks.forEach(track => {
                if (track.readyState === 'live') {
                    track.stop();
                }
            });
            this.stream = null;
        }
        if (window.audioElements) {
            window.audioElements.forEach((element, key) => {
                if (element && element.parentNode) {
                    element.pause();
                    element.srcObject = null;
                    element.parentNode.removeChild(element);
                }
            });
            window.audioElements.clear();
        }
        this.isConnected = false;
        this.isMicActive = false;
        console.log('[DESTROY] Очистка ресурсов завершена');
    }
}
let voiceChatClient = null;
document.addEventListener('DOMContentLoaded', () => {
    console.log('[DOM] DOMContentLoaded event');
    if (typeof mediasoupClient === 'undefined') {
        console.error('[DOM] mediasoupClient не найден при DOMContentLoaded');
        const statusText = document.getElementById('statusText');
        const statusIndicator = document.getElementById('statusIndicator');
        if (statusText) statusText.textContent = 'Ошибка: mediasoup-client не загружен';
        if (statusIndicator) statusIndicator.className = 'status-indicator disconnected';
        return;
    }
    console.log('[DOM] Создание экземпляра VoiceChatClient');
    voiceChatClient = new VoiceChatClient();
    console.log('[DOM] Автоматический запуск подключения');
    if (voiceChatClient) {
         voiceChatClient.connectToServer().catch(err => {
             console.error('[DOM] Ошибка при автоматическом подключении:', err);
         });
    }
    const compactMicBtn = document.getElementById('compactMicBtn');
    const checkScreenSizeAndAdjustUI = () => {
        if (window.innerWidth <= 900) {
            if (compactMicBtn) {
                compactMicBtn.style.display = 'flex'; // Используем flex для корректного отображения
            }
        } else {
            if (compactMicBtn) {
                compactMicBtn.style.display = 'none';
            }
        }
    };
    checkScreenSizeAndAdjustUI();
    window.addEventListener('resize', checkScreenSizeAndAdjustUI);
    const sidebar = document.getElementById('sidebar');
    const membersPanel = document.getElementById('membersPanel');
    const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
    const toggleMembersBtn = document.getElementById('toggleMembersBtn');
    const closeMembersPanelBtn = document.getElementById('closeMembersPanelBtn');
    let isSidebarVisible = false;
    let isMembersPanelVisible = false;
    function toggleSidebar() {
        if (!sidebar) return;
        isSidebarVisible = !isSidebarVisible;
        if (isSidebarVisible) {
            sidebar.classList.add('visible');
        } else {
            sidebar.classList.remove('visible');
        }
    }
    function toggleMembersPanel() {
        if (!membersPanel) return;
        isMembersPanelVisible = !isMembersPanelVisible;
        if (isMembersPanelVisible) {
            membersPanel.classList.add('visible');
        } else {
            membersPanel.classList.remove('visible');
        }
    }
    if (toggleSidebarBtn) toggleSidebarBtn.addEventListener('click', toggleSidebar);
    if (toggleMembersBtn) toggleMembersBtn.addEventListener('click', toggleMembersPanel);
    if (closeMembersPanelBtn) closeMembersPanelBtn.addEventListener('click', toggleMembersPanel);
    document.addEventListener('click', (e) => {
        if (sidebar && isSidebarVisible && !sidebar.contains(e.target) && e.target !== toggleSidebarBtn) {
            isSidebarVisible = false;
            sidebar.classList.remove('visible');
        }
        if (membersPanel && isMembersPanelVisible && !membersPanel.contains(e.target) && e.target !== toggleMembersBtn) {
            isMembersPanelVisible = false;
            membersPanel.classList.remove('visible');
        }
    });
    console.log('[DOM] Обработчики для адаптивности добавлены');
});
window.addEventListener('beforeunload', () => {
    console.log('[WINDOW] beforeunload event');
    if (voiceChatClient) {
        voiceChatClient.destroy();
    }
});