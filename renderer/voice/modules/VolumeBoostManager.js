// VolumeBoostManager.js
// Модуль для усиления звука конкретного говорящего (gain/усиление) в голосовом чате.
// Формат: ES Module. Помещается в renderer/voice/modules/
// Как использовать (пример):
// import VolumeBoostManager from './modules/VolumeBoostManager.js';
// VolumeBoostManager.resume(); // резюмирует AudioContext при первом взаимодействии (рекомендуется вызвать по user gesture)
// // если у вас есть HTMLAudioElement, связанный с пользователем:
// VolumeBoostManager.attachToAudioElement(audioElement, userId); // audioElement может иметь srcObject = MediaStream или src = URL
// VolumeBoostManager.setGain(userId, 1.8); // усилить в 1.8 раза
// VolumeBoostManager.detach(userId); // вернуть всё назад и освободить ресурсы
//
// Примечания:
// - Модуль использует WebAudio API: AudioContext, GainNode, MediaStreamDestination и MediaStreamSource.
// - Если audioElement уже воспроизводил поток, модуль перенаправит воспроизведение через internal MediaStreamDestination.
// - Не изменяет глобальные настройки приложения (при удалении/detach восстанавливает поведение аудио-элемента в меру возможности).

class VolumeBoostManager {
    static audioCtx = null;
    // userId => { source, gainNode, dest, audioElement, originalSrcObject }
    static boosts = new Map();

    static _ensureAudioContext() {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        return this.audioCtx;
    }

    // Resume context (call on user gesture if needed)
    static async resume() {
        const ctx = this._ensureAudioContext();
        if (ctx.state === 'suspended') {
            try {
                await ctx.resume();
                console.log('VolumeBoostManager: AudioContext resumed');
            } catch (e) {
                console.warn('VolumeBoostManager: resume failed', e);
            }
        }
    }

    // Attach boost to HTMLAudioElement. audioElement can have .srcObject (MediaStream) or .src (URL)
    static attachToAudioElement(audioElement, userId, initialGain = 1.0) {
        if (!audioElement) return;
        const ctx = this._ensureAudioContext();

        // If there is already a boost for this user, detach first
        if (this.boosts.has(userId)) {
            this.detach(userId);
        }

        let src = null;
        let createdFromStream = false;
        let originalSrcObject = audioElement.srcObject;

        try {
            if (audioElement.srcObject instanceof MediaStream) {
                // create MediaStreamSource from the stream
                src = ctx.createMediaStreamSource(audioElement.srcObject);
                createdFromStream = true;
            } else {
                // create source from media element
                // Note: createMediaElementSource requires the element to be in the same document and not cross-origin for audio graph.
                src = ctx.createMediaElementSource(audioElement);
            }
        } catch (e) {
            console.warn('VolumeBoostManager: create source fallback', e);
            // If failed to create source (cross-origin or other), fallback to no-op
            return;
        }

        const gainNode = ctx.createGain();
        gainNode.gain.value = Number(initialGain) || 1.0;
        // Optional: add a soft limiter (dynamics compressor) to avoid clipping when applying large gain
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -3; // dB
        compressor.knee.value = 6;
        compressor.ratio.value = 6;
        compressor.attack.value = 0.01;
        compressor.release.value = 0.2;

        // Create destination stream and route the processed audio to it
        const dest = ctx.createMediaStreamDestination();
        // Source -> gain -> compressor -> dest
        src.connect(gainNode);
        gainNode.connect(compressor);
        compressor.connect(dest);

        // Preserve element's playback state; set new srcObject to processed stream
        try {
            // Pause, change source, then play if it was playing
            const wasPlaying = !audioElement.paused && !audioElement.ended;
            audioElement.pause();
            audioElement.srcObject = dest.stream;
            // keep same currentTime if applicable (note: for streams currentTime not used)
            if (wasPlaying) {
                // Some browsers require a user gesture to start audio; caller should handle resume()
                const p = audioElement.play();
                if (p && p.catch) p.catch(e => console.warn('VolumeBoostManager: play rejected', e));
            }
        } catch (e) {
            console.warn('VolumeBoostManager: error while reassigning srcObject', e);
        }

        this.boosts.set(userId, {
            source: src,
            gainNode,
            compressor,
            dest,
            audioElement,
            originalSrcObject,
            createdFromStream
        });

        console.log('VolumeBoostManager: attached boost for', userId, 'gain=', gainNode.gain.value);
    }

    // Attach boost directly to a MediaStream (no audio element handling) and return boosted MediaStream
    static attachToMediaStream(mediaStream, userId, initialGain = 1.0) {
        if (!(mediaStream instanceof MediaStream)) return null;
        const ctx = this._ensureAudioContext();
        if (this.boosts.has(userId)) this.detach(userId);

        const src = ctx.createMediaStreamSource(mediaStream);
        const gainNode = ctx.createGain();
        gainNode.gain.value = Number(initialGain) || 1.0;

        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -3;
        compressor.knee.value = 6;
        compressor.ratio.value = 6;
        compressor.attack.value = 0.01;
        compressor.release.value = 0.2;

        const dest = ctx.createMediaStreamDestination();
        src.connect(gainNode);
        gainNode.connect(compressor);
        compressor.connect(dest);

        this.boosts.set(userId, {
            source: src,
            gainNode,
            compressor,
            dest,
            audioElement: null,
            originalSrcObject: null,
            createdFromStream: true
        });

        console.log('VolumeBoostManager: attached to MediaStream for', userId, 'gain=', gainNode.gain.value);
        return dest.stream;
    }

    // Set gain for userId (1.0 = original, >1 = boost, <1 = attenuation)
    static setGain(userId, value) {
        const entry = this.boosts.get(userId);
        if (!entry) {
            console.warn('VolumeBoostManager: setGain no entry for', userId);
            return;
        }
        const v = Number(value);
        if (isNaN(v) || !isFinite(v)) return;
        // clamp to [0, 10] to avoid absurd values
        const clamped = Math.max(0, Math.min(10, v));
        entry.gainNode.gain.setValueAtTime(clamped, this.audioCtx.currentTime);
        console.log('VolumeBoostManager: setGain', userId, clamped);
    }

    // Detach and restore audioElement to original srcObject if possible
    static detach(userId) {
        const entry = this.boosts.get(userId);
        if (!entry) return;
        try {
            // disconnect nodes
            if (entry.source) {
                try { entry.source.disconnect(); } catch (e) {}
            }
            if (entry.gainNode) {
                try { entry.gainNode.disconnect(); } catch (e) {}
            }
            if (entry.compressor) {
                try { entry.compressor.disconnect(); } catch (e) {}
            }
            if (entry.dest) {
                try { entry.dest.disconnect(); } catch (e) {}
            }
            // restore audio element original stream if we modified it
            if (entry.audioElement) {
                try {
                    // Pause and restore original stream
                    const ae = entry.audioElement;
                    const wasPlaying = !ae.paused && !ae.ended;
                    ae.pause();
                    ae.srcObject = entry.originalSrcObject || null;
                    if (wasPlaying) {
                        const p = ae.play();
                        if (p && p.catch) p.catch(()=>{});
                    }
                } catch (e) {
                    console.warn('VolumeBoostManager: restore audioElement failed', e);
                }
            }
        } catch (e) {
            console.warn('VolumeBoostManager: detach error', e);
        } finally {
            this.boosts.delete(userId);
            console.log('VolumeBoostManager: detached', userId);
        }
    }

    // Detach all entries and close AudioContext (optional)
    static detachAll() {
        for (const userId of Array.from(this.boosts.keys())) {
            this.detach(userId);
        }
    }

    // Get current gain value for userId
    static getGain(userId) {
        const entry = this.boosts.get(userId);
        if (!entry) return null;
        return entry.gainNode.gain.value;
    }
}

export default VolumeBoostManager;
