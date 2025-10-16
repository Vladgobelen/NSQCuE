// MediaManager.js
import UIManager from './UIManager.js';
import MembersManager from './MembersManager.js';
// 🔊 === НАЧАЛО ИНТЕГРАЦИИ VolumeBoostManager ===
import VolumeBoostManager from './VolumeBoostManager.js';
// 🔊 === КОНЕЦ ИНТЕГРАЦИИ VolumeBoostManager ===

class MediaManager {
    static async connect(client, roomId, mediaData) {
        console.log('MediaManager connecting to room:', roomId);
        try {
            if (typeof mediasoupClient === 'undefined') {
                throw new Error('Библиотека mediasoup-client не загружена');
            }
            client.device = new mediasoupClient.Device();
            await client.device.load({ routerRtpCapabilities: mediaData.rtpCapabilities });
            await this.createTransports(client, mediaData);
            this.startKeepAlive(client, roomId);
            client.isConnected = true;
            client.isMicActive = false;
            client.existingProducers = new Set();
            client.consumers = new Map();
            await this.requestCurrentProducers(client, roomId);
            console.log('MediaManager connected successfully');
        } catch (error) {
            console.error('MediaManager connection failed:', error);
            throw new Error(`Media connection failed: ${error.message}`);
        }
    }
    static async enableMicrophone(client) {
        console.log('Enabling microphone for client:', client.clientID);
        if (client.audioProducer && client.audioProducer.track) {
            if (client.audioProducer.closed || (client.sendTransport && client.sendTransport.closed)) {
                console.log('Audio producer or its transport is closed, restarting microphone...');
                await MediaManager.stopMicrophone(client, false);
                await MediaManager.startMicrophone(client);
                return true;
            }
            client.audioProducer.track.enabled = true;
            client.isMicActive = true;
            console.log('Microphone enabled successfully');
            return true;
        } else {
            console.log('No audio producer or track found, starting microphone...');
            await MediaManager.startMicrophone(client);
            return true;
        }
    }
    static async disableMicrophone(client) {
        console.log('Disabling microphone for client:', client.clientID);
        if (client.audioProducer && client.audioProducer.track) {
            client.audioProducer.track.enabled = false;
            client.isMicActive = false;
            console.log('Microphone disabled successfully');
            return true;
        } else {
            console.log('No audio producer or track found, cannot disable');
            return false;
        }
    }
    static async createTransports(client, mediaData) {
        console.log('Creating transports for client:', client.clientID);
        try {
            if (!client.sendTransport) {
                console.log('Creating send transport');
                client.sendTransport = client.device.createSendTransport({
                    id: mediaData.sendTransport.id,
                    iceParameters: mediaData.sendTransport.iceParameters,
                    iceCandidates: mediaData.sendTransport.iceCandidates,
                    dtlsParameters: mediaData.sendTransport.dtlsParameters
                });
                this.setupSendTransportHandlers(client);
            } else {
                console.log('Send transport already exists, reusing');
            }
            if (!client.recvTransport) {
                console.log('Creating receive transport');
                client.recvTransport = client.device.createRecvTransport({
                    id: mediaData.recvTransport.id,
                    iceParameters: mediaData.recvTransport.iceParameters,
                    iceCandidates: mediaData.recvTransport.iceCandidates,
                    dtlsParameters: mediaData.recvTransport.dtlsParameters
                });
                this.setupRecvTransportHandlers(client);
            } else {
                console.log('Receive transport already exists, reusing');
            }
        } catch (error) {
            console.error('Error creating transports:', error);
            throw error;
        }
    }
    static setupSendTransportHandlers(client) {
        console.log('Setting up send transport handlers');
        client.sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            console.log('Send transport connecting...');
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);
                await fetch(`${client.API_SERVER_URL}/api/media/transport/connect`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${client.token}`
                    },
                    body: JSON.stringify({
                        transportId: client.sendTransport.id,
                        dtlsParameters: dtlsParameters
                    }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                console.log('Send transport connected successfully');
                callback();
            } catch (error) {
                console.error('Send transport connection failed:', error);
                errback(error);
            }
        });
        client.sendTransport.on('produce', async (parameters, callback, errback) => {
            console.log('Producing media:', parameters.kind);
            try {
                const response = await fetch(`${client.API_SERVER_URL}/api/media/produce`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${client.token}`
                    },
                    body: JSON.stringify({
                        transportId: client.sendTransport.id,
                        kind: parameters.kind,
                        rtpParameters: parameters.rtpParameters,
                        clientId: client.clientID,
                        roomId: client.currentRoom
                    })
                });
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('Produce failed:', response.status, errorText);
                    throw new Error(`HTTP error: ${response.status}`);
                }
                const data = await response.json();
                console.log('Media produced successfully:', data.producerId);
                callback({ id: data.producerId });
            } catch (error) {
                console.error('Produce failed:', error);
                errback(error);
            }
        });
    }
    static setupRecvTransportHandlers(client) {
        console.log('Setting up receive transport handlers');
        client.recvTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            console.log('Receive transport connecting...');
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);
                await fetch(`${client.API_SERVER_URL}/api/media/transport/connect`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${client.token}`
                    },
                    body: JSON.stringify({
                        transportId: client.recvTransport.id,
                        dtlsParameters: dtlsParameters
                    }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                console.log('Receive transport connected successfully');
                callback();
            } catch (error) {
                console.error('Receive transport connection failed:', error);
                errback(error);
            }
        });
    }
    static async startMicrophone(client) {
        console.log('Starting microphone for client:', client.clientID);
        try {
            if (!client.sendTransport) {
                console.error('Send transport is not initialized');
                throw new Error('Send transport не инициализирован');
            }
            const constraints = {
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1,
                    latency: 0.1,
                    sampleSize: 16
                }
            };
            client.stream = await navigator.mediaDevices.getUserMedia(constraints);
            const track = client.stream.getAudioTracks()[0];
            client.audioProducer = await client.sendTransport.produce({
                track,
                encodings: [
                    {
                        maxBitrate: 24000,
                        dtx: true
                    }
                ],
                appData: {
                    clientID: client.clientID,
                    roomId: client.currentRoom
                }
            });
            client.isMicActive = true;
            console.log('Microphone started successfully');
            if (client.socket && client.audioProducer) {
                client.socket.emit('new-producer-notification', {
                    roomId: client.currentRoom,
                    producerId: client.audioProducer.id,
                    clientID: client.clientID,
                    userId: client.userId,
                    kind: 'audio'
                });
            }
        } catch (error) {
            console.error('Microphone start failed:', error);
            if (client.stream) {
                client.stream.getTracks().forEach(track => track.stop());
                client.stream = null;
            }
            throw error;
        }
    }
    static async stopMicrophone(client, closeTransport = true) {
        console.log('Stopping microphone for client:', client.clientID);
        try {
            if (client.audioProducer) {
                try {
                    await fetch(`${client.API_SERVER_URL}/api/media/producer/close`, {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${client.token}`
                        },
                        body: JSON.stringify({
                            producerId: client.audioProducer.id
                        })
                    });
                } catch (error) {
                    console.warn('Error closing producer on server:', error);
                }
                client.audioProducer.close();
                client.audioProducer = null;
            }
            if (client.stream) {
                client.stream.getTracks().forEach(track => track.stop());
                client.stream = null;
            }
            if (closeTransport && client.sendTransport) {
                try {
                    client.sendTransport.close();
                } catch (error) {
                    console.warn('Error closing send transport:', error);
                }
                client.sendTransport = null;
            }
            client.isMicActive = false;
            console.log('Microphone stopped successfully');
        } catch (error) {
            console.error('Microphone stop failed:', error);
            throw new Error(`Microphone stop failed: ${error.message}`);
        }
    }
    static startKeepAlive(client, roomId) {
        console.log('Starting keep-alive for client:', client.clientID);
        if (client.keepAliveInterval) {
            clearInterval(client.keepAliveInterval);
        }
        client.keepAliveInterval = setInterval(() => {
            fetch(`${client.API_SERVER_URL}/api/media/health`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${client.token}`
                },
                body: JSON.stringify({
                    clientId: client.clientID,
                    roomId: roomId
                })
            }).catch(() => {
                console.warn('Keep-alive request failed');
            });
        }, 10000);
    }
    static async requestCurrentProducers(client, roomId) {
        console.log('Requesting current producers for room:', roomId);
        try {
            const response = await fetch(`${client.API_SERVER_URL}/api/media/rooms/${roomId}/producers`, {
                headers: {
                    'Authorization': `Bearer ${client.token}`,
                    'Content-Type': 'application/json'
                }
            });
            if (!response.ok) {
                console.warn('Failed to get producers list:', response.status);
                return;
            }
            const data = await response.json();
            if (!data || !data.producers || !Array.isArray(data.producers)) {
                console.warn('Invalid producers data received:', data);
                return;
            }
            console.log('Found', data.producers.length, 'producers in room');
            for (const producer of data.producers) {
                if (producer.clientID !== client.clientID) {
                    await client.ensureConsumer(producer.id, producer);
                    // 🔹 После успешного ensureConsumer — ищем userId по clientId
                    if (!window.producerUserMap) window.producerUserMap = new Map();
                    const members = MembersManager.getMembers();
                    const member = members.find(m => m.clientId === producer.clientID);
                    if (member?.userId) {
                        window.producerUserMap.set(producer.id, member.userId);
                        UIManager.showVolumeSliderByUserId(producer.id, member.userId);
                    }
                } else {
                    client.consumerState.set(producer.id, { status: 'active', consumer: null, lastError: null });
                    console.log('Own producer found in initial list:', producer.id);
                }
            }
        } catch (error) {
            console.error('Error requesting current producers:', error);
        }
    }
    static async createConsumer(client, producerId, retries = 3, producerData = {}) {
        console.group('🎯 MediaManager.createConsumer - START');
        console.log('🔹 producerId:', producerId);
        console.log('🔹 producerData:', producerData);
        console.log('🔹 client.clientID:', client.clientID);
        console.groupEnd();
        if (client.audioProducer && client.audioProducer.id === producerId) {
            console.log('❌ Skipping own producer');
            throw new Error('Cannot consume own producer');
        }
        if (client.consumers.has(producerId)) {
            console.log('ℹ️ Consumer already exists for producer:', producerId);
            const existingConsumer = client.consumers.get(producerId);
            if (existingConsumer.closed || existingConsumer.transportClosed) {
                console.log('🔄 Existing consumer is closed, creating new one');
                client.consumers.delete(producerId);
            } else {
                return existingConsumer;
            }
        }
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                console.group(`🔄 Creating consumer attempt ${attempt}/${retries}`);
                console.log('🔹 producerId:', producerId);
                const response = await fetch(`${client.API_SERVER_URL}/api/media/consume`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${client.token}`
                    },
                    body: JSON.stringify({
                        producerId: producerId,
                        rtpCapabilities: client.device.rtpCapabilities,
                        transportId: client.recvTransport.id,
                        clientId: client.clientID
                    })
                });
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('❌ HTTP error:', response.status, errorText);
                    if (response.status === 400 && errorText.includes('own audio')) {
                        throw new Error('Cannot consume own audio');
                    }
                    throw new Error(`HTTP error: ${response.status}`);
                }
                const data = await response.json();
                console.log('🔹 Server response ', data);
                if (!data || !data.id) {
                    console.error('❌ Invalid consumer data received:', data);
                    throw new Error('Invalid consumer data received');
                }
                console.log('✅ Consumer data received from server:', data.id);
                const consumer = await client.recvTransport.consume({
                    id: data.id,
                    producerId: data.producerId,
                    kind: data.kind,
                    rtpParameters: data.rtpParameters
                });
                client.consumers.set(producerId, consumer);
                let audioElement = window.audioElements?.get(producerId);
                if (!audioElement || audioElement.closed) {
                    audioElement = new Audio();
                    audioElement.id = `audio-${producerId}`;
                    audioElement.autoplay = true;
                    audioElement.volume = 1.0;
                    audioElement.style.display = 'none';
                    if (!window.audioElements) window.audioElements = new Map();
                    window.audioElements.set(producerId, audioElement);
                    document.body.appendChild(audioElement);
                    console.log('🎵 New audio element created for producer:', producerId);
                }
                const stream = new MediaStream([consumer.track.clone()]);
                audioElement.srcObject = stream;
// 🔹 Сохраняем маппинги для последующей синхронизации в syncVolumeSliders
if (producerData.userId) {
    if (!window.producerUserMap) window.producerUserMap = new Map();
    window.producerUserMap.set(data.producerId, producerData.userId);
} else if (producerData.clientID) {
    if (!window.producerClientMap) window.producerClientMap = new Map();
    window.producerClientMap.set(data.producerId, producerData.clientID);
}
                consumer.on('transportclose', () => {
                    console.log('🔌 Consumer transport closed:', consumer.id);
                    consumer.transportClosed = true;
                });
                consumer.on('trackended', () => {
                    console.log('🔇 Consumer track ended:', consumer.id);
                });
                // 🔊 === НАЧАЛО ИНТЕГРАЦИИ VolumeBoostManager ===
                // После создания audioElement — подключаем VolumeBoostManager
                if (producerData.userId) {
                    VolumeBoostManager.attachToAudioElement(audioElement, producerData.userId, 1.0);
                } else if (producerData.clientID) {
                    // fallback: используем clientID как временный userId
                    VolumeBoostManager.attachToAudioElement(audioElement, producerData.clientID, 1.0);
                }
                // 🔊 === КОНЕЦ ИНТЕГРАЦИИ VolumeBoostManager ===
                console.log('✅ Consumer created successfully:', data.id);
                console.groupEnd();
                return consumer;
            } catch (error) {
                console.error(`❌ Error creating consumer (attempt ${attempt}/${retries}):`, error);
                if (error.message.includes('consume own') || 
                    error.message.includes('own audio') || 
                    error.message.includes('400') ||
                    error.message.includes('Cannot consume own')) {
                    client.existingProducers.add(producerId);
                    console.log('🔇 Added to excluded producers:', producerId);
                    throw error;
                }
                if (attempt === retries) {
                    console.groupEnd();
                    throw error;
                }
                const delay = Math.pow(2, attempt) * 1000;
                console.log(`⏳ Waiting ${delay}ms before next attempt...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                console.groupEnd();
            }
        }
    }
    static disconnect(client) {
        console.log('Disconnecting media for client:', client.clientID);
        if (client.keepAliveInterval) {
            clearInterval(client.keepAliveInterval);
            client.keepAliveInterval = null;
        }
        if (client.isMicActive) {
            this.stopMicrophone(client).catch(() => {
                console.warn('Error stopping microphone during disconnect');
            });
        }
        if (client.sendTransport) {
            try {
                client.sendTransport.close();
            } catch (error) {
                console.warn('Error closing send transport:', error);
            }
            client.sendTransport = null;
        }
        if (client.recvTransport) {
            try {
                client.recvTransport.close();
            } catch (error) {
                console.warn('Error closing receive transport:', error);
            }
            client.recvTransport = null;
        }
        client.consumers.forEach(consumer => {
            try {
                consumer.close();
            } catch (error) {
                console.warn('Error closing consumer:', error);
            }
        });
        client.consumers.clear();
        if (window.audioElements) {
            window.audioElements.forEach(audio => {
                try {
                    audio.pause();
                    audio.srcObject = null;
                    audio.remove();
                    // 🔊 === НАЧАЛО ИНТЕГРАЦИИ VolumeBoostManager ===
                    // Отключаем усиление при удалении audioElement
                    const producerId = audio.id.replace('audio-', '');
                    const userId = window.producerUserMap?.get(producerId) || window.producerClientMap?.get(producerId);
                    if (userId) {
                        VolumeBoostManager.detach(userId);
                    }
                    // 🔊 === КОНЕЦ ИНТЕГРАЦИИ VolumeBoostManager ===
                } catch (error) {
                    console.warn('Error cleaning up audio element:', error);
                }
            });
            window.audioElements.clear();
        }
        client.device = null;
        client.isConnected = false;
        client.existingProducers.clear();
        console.log('Media disconnected successfully');
    }
    static async handleNewProducer(client, producerData) {
        console.group('🔴🔴🔴 [DEBUG] MEDIA MANAGER: handleNewProducer');
        console.log('🎯 [DEBUG] CALLED handleNewProducer with ', JSON.stringify(producerData, null, 2));
        console.log('🎯 [DEBUG] CLIENT STATE - clientID:', client.clientID);
        console.log('🎯 [DEBUG] CLIENT STATE - existingProducers (BEFORE):', Array.from(client.existingProducers));
        console.log('🎯 [DEBUG] CHECK: Is this my own producer?', producerData.clientID === client.clientID);
        console.log('🎯 [DEBUG] CHECK: Is producer already in existingProducers?', client.existingProducers.has(producerData.producerId));
        console.groupEnd();
        console.log('Handling new producer notification:', producerData);
        if (producerData.clientID !== client.clientID) {
            console.log('🎧 [DEBUG] MediaManager: Attempting to create consumer for producer:', producerData.producerId);
            try {
                await this.createConsumer(client, producerData.producerId);
                client.existingProducers.add(producerData.producerId);
                console.log('✅ [DEBUG] MediaManager: Consumer created and producerId added to existingProducers:', producerData.producerId);
            } catch (error) {
                console.error('❌ Error creating consumer from notification:', error);
                console.log('❌ [DEBUG] MediaManager: Consumer creation FAILED for producer:', producerData.producerId);
            }
        } else {
            console.log('🔇 [DEBUG] MediaManager: Ignoring own producer:', producerData.producerId);
        }
        console.group('🔴🔴🔴 [DEBUG] AFTER MediaManager.handleNewProducer');
        console.log('🎯 [DEBUG] CLIENT STATE - existingProducers (AFTER):', Array.from(client.existingProducers));
        console.groupEnd();
    }
}
export default MediaManager;
