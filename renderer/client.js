class VoiceChatClient {
  constructor() {
    this.SERVER_URL = 'http://194.31.171.29:38592';
    this.clientID = this.generateClientID();
    this.device = null;
    this.sendTransport = null;
    this.recvTransport = null;
    this.producer = null;
    this.consumer = null;
    this.stream = null;
    this.isConnected = false;
    this.isMicActive = false;
    this.updateInterval = null;

    // === ДОБАВЛЕНО: Настройки качества звука ===
    this.bitrate = 32000; // По умолчанию 32 кбит/с
    this.dtxEnabled = true; // По умолчанию DTX включен
    this.fecEnabled = true; // По умолчанию FEC включен
    // === КОНЕЦ ДОБАВЛЕНИЯ ===

    window.voiceChatClient = this;

    // Элементы UI
    console.log('[CONSTRUCTOR] Получение элементов UI');
    this.micButton = document.getElementById('micButton');
    this.micButtonText = document.getElementById('micButtonText');
    this.statusText = document.getElementById('statusText');
    this.statusIndicator = document.getElementById('statusIndicator');
    this.compactMicBtn = document.getElementById('compactMicBtn');
    this.messageInput = document.getElementById('messageInput');
    this.messagesContainer = document.getElementById('messagesContainer');
    this.currentRoomTitle = document.getElementById('currentRoomTitle');
    this.roomItems = document.querySelectorAll('.room-item');
    this.backBtn = document.getElementById('backBtn');
    this.sidebarBackBtn = document.getElementById('backBtn'); // Общая кнопка
    this.toggleMembersBtn = document.getElementById('toggleMembersBtn');
    this.membersPanel = document.getElementById('membersPanel');
    this.closeMembersPanel = document.getElementById('closeMembersPanel');
    this.membersList = document.getElementById('membersList');

    // Элементы настроек
    this.settingsModal = document.getElementById('settingsModal');
    this.bitrateSlider = document.getElementById('bitrateSlider');
    this.bitrateValue = document.getElementById('bitrateValue');
    this.dtxCheckbox = document.getElementById('dtxCheckbox');
    this.fecCheckbox = document.getElementById('fecCheckbox');
    this.applySettingsBtn = document.getElementById('applySettingsBtn');
    this.closeSettingsModal = document.getElementById('closeSettingsModal');
    this.openSettingsBtn = document.getElementById('chatOpenSettingsBtn');

    console.log('[CONSTRUCTOR] Проверка наличия mediasoupClient');
    if (typeof mediasoupClient === 'undefined') {
      console.error('[CONSTRUCTOR] mediasoupClient не найден');
      this.updateStatus('Ошибка: mediasoup-client не загружен', 'disconnected');
      if (this.compactMicBtn) this.compactMicBtn.disabled = true;
      return;
    }

    this.setupInitialUI();
    this.setupEventListeners();
    console.log('[CONSTRUCTOR] Инициализация завершена');
  }

  setupInitialUI() {
    console.log('[UI] Настройка начального UI');
    if (this.compactMicBtn) {
      this.compactMicBtn.disabled = true;
      this.compactMicBtn.onclick = null;
    }
    this.updateStatus('Готов', 'normal');
  }

  setupEventListeners() {
    // Кнопка микрофона
    if (this.compactMicBtn) {
      this.compactMicBtn.addEventListener('click', () => this.toggleMicrophone());
    }

    // Кнопка участников
    if (this.toggleMembersBtn) {
      this.toggleMembersBtn.addEventListener('click', () => {
        this.membersPanel.classList.add('visible');
      });
    }

    if (this.closeMembersPanel) {
      this.closeMembersPanel.addEventListener('click', () => {
        this.membersPanel.classList.remove('visible');
      });
    }

    // Закрытие панели кликом вне
    this.membersPanel.addEventListener('click', (e) => {
      if (e.target === this.membersPanel) {
        this.membersPanel.classList.remove('visible');
      }
    });

    // Обработчики настроек
    if (this.openSettingsBtn) {
      this.openSettingsBtn.addEventListener('click', () => this.openSettings());
    }

    if (this.closeSettingsModal) {
      this.closeSettingsModal.addEventListener('click', () => {
        this.settingsModal.style.display = 'none';
      });
    }

    if (this.bitrateSlider) {
      this.bitrateSlider.addEventListener('input', () => {
        this.bitrateValue.textContent = this.bitrateSlider.value;
      });
    }

    if (this.applySettingsBtn) {
      this.applySettingsBtn.addEventListener('click', () => this.applySettings());
    }

    window.addEventListener('click', (e) => {
      if (this.settingsModal && e.target === this.settingsModal) {
        this.settingsModal.style.display = 'none';
      }
    });

    // Отправка сообщений
    this.messageInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendMessage();
    });

    // Кнопка "Назад"
    const handleBack = () => this.hideUI();
    this.backBtn?.addEventListener('click', handleBack);
    this.sidebarBackBtn?.addEventListener('click', handleBack);
  }

  async connectToServer() {
    try {
      this.updateStatus('Подключение...', 'connecting');
      await this.registerClient();
      this.startKeepAlive();
      const rtpCapabilities = await this.getRtpCapabilities();
      await this.createDevice(rtpCapabilities);
      await this.createTransports();
      this.isConnected = true;
      this.updateStatus('Подключено', 'connected');
      this.compactMicBtn.disabled = false;
    } catch (error) {
      this.updateStatus('Ошибка: ' + error.message, 'disconnected');
      console.error('[CONNECT ERROR]', error);
    }
  }

  async registerClient() {
    const response = await fetch(`${this.SERVER_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientID: this.clientID })
    });
    if (!response.ok) throw new Error('Register failed');
    return response.json();
  }

  async getRtpCapabilities() {
    const response = await fetch(`${this.SERVER_URL}/api/rtp-capabilities`);
    if (!response.ok) throw new Error('RTP failed');
    return response.json();
  }

  async createDevice(rtpCapabilities) {
    this.device = new mediasoupClient.Device();
    await this.device.load({ routerRtpCapabilities: rtpCapabilities });
  }

  async createTransports() {
    const sendTransportData = await this.createTransport('send');
    this.sendTransport = this.device.createSendTransport(sendTransportData);

    this.sendTransport.on('connect', async ({ dtlsParameters }, cb, eb) => {
      try {
        await fetch(`${this.SERVER_URL}/api/transport/connect`, {
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
        cb();
      } catch (err) {
        eb(err);
      }
    });
  }

  async createTransport(direction) {
    const response = await fetch(`${this.SERVER_URL}/api/transport/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-ID': this.clientID
      },
      body: JSON.stringify({ clientID: this.clientID, direction })
    });
    return response.json();
  }

  async startMicrophone() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 48000,
          channelCount: 1,
          bitrate: this.bitrate,
          dtx: this.dtxEnabled,
          fec: this.fecEnabled
        }
      });

      if (this.sendTransport) {
        this.producer = await this.sendTransport.produce({
          track: this.stream.getAudioTracks()[0],
          codecOptions: {
            opusDtx: this.dtxEnabled,
            opusFec: this.fecEnabled,
            opusPtime: 20
          }
        });
      }

      this.isMicActive = true;
      this.compactMicBtn.classList.add('active');
      this.updateStatus('Микрофон включен', 'connected');
    } catch (error) {
      this.updateStatus('Ошибка: ' + error.message, 'disconnected');
    }
  }

  toggleMicrophone() {
    if (this.isMicActive) {
      this.stopMicrophone();
    } else {
      this.startMicrophone();
    }
  }

  stopMicrophone() {
    if (this.producer) this.producer.close();
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.isMicActive = false;
    this.compactMicBtn.classList.remove('active');
    this.updateStatus('Микрофон выключен', 'connected');
  }

  // === МЕТОДЫ НАСТРОЕК ===
  openSettings() {
    if (!this.settingsModal) return;
    this.bitrateSlider.value = this.bitrate / 1000;
    this.bitrateValue.textContent = this.bitrateSlider.value;
    this.dtxCheckbox.checked = this.dtxEnabled;
    this.fecCheckbox.checked = this.fecEnabled;
    this.settingsModal.style.display = 'block';
  }

  async applySettings() {
    this.bitrate = this.bitrateSlider.value * 1000;
    this.dtxEnabled = this.dtxCheckbox.checked;
    this.fecEnabled = this.fecCheckbox.checked;
    this.settingsModal.style.display = 'none';

    if (this.isMicActive) {
      this.stopMicrophone();
      await this.startMicrophone();
    }
    this.addMessage('System', 'Настройки применены');
  }

  // === UI ===
  updateStatus(message, type = 'normal') {
    console.log(`[STATUS] ${message}`);
    if (this.statusText) this.statusText.textContent = message;
    if (this.statusIndicator) {
      this.statusIndicator.className = `status-indicator ${type}`;
    }
  }

  addMessage(sender, text) {
    const el = document.createElement('div');
    el.className = `message ${sender === 'You' ? 'own' : ''}`;
    el.textContent = `${sender}: ${text}`;
    this.messagesContainer.appendChild(el);
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  hideUI() {
    const app = document.querySelector('.app');
    const bar = document.querySelector('.status-bar');
    if (app) app.style.display = 'none';
    if (bar) bar.style.display = 'none';
  }

  startKeepAlive() {
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    this.keepAliveInterval = setInterval(() => {
      this.registerClient().catch(console.log);
    }, 5000);
  }

  destroy() {
    this.stopMicrophone();
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
  }
}

// === ЗАПУСК ===
window.addEventListener('DOMContentLoaded', () => {
  if (typeof mediasoupClient === 'undefined') {
    const statusText = document.getElementById('statusText');
    const statusIndicator = document.getElementById('statusIndicator');
    if (statusText) statusText.textContent = 'Ошибка: mediasoup-client не загружен';
    if (statusIndicator) statusIndicator.className = 'status-indicator disconnected';
  } else {
    window.voiceChatClient = new VoiceChatClient();
    voiceChatClient.connectToServer().catch(console.error);
  }
});

window.addEventListener('beforeunload', () => {
  if (voiceChatClient) voiceChatClient.destroy();
});