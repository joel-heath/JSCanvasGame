// audioEngine.js

function timeout(func, ms) {
    return new Promise(resolve => setTimeout(() => {
        func();
        resolve();
    }, ms));
}

class AudioEngine {
    constructor() {
        this.audioContext = null;
        this.musicSource = null;
        this.musicGainNode = null;
        this.currentMusicBuffer = null;
        this.musicStartTime = 0;
        this.musicPauseOffset = 0;
        this.soundCooldowns = new Map();
    }

    /**
     * Initializes the AudioContext. Must be called after a user interaction (e.g., a click).
     */
    _initContext() {
        if (this.audioContext) return;
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.musicGainNode = this.audioContext.createGain();
        this.musicGainNode.connect(this.audioContext.destination);
    }

    /**
     * Plays a music track. If another track is playing, it crossfades to the new one.
     * @param {AudioBuffer} audioBuffer The pre-loaded audio buffer to play.
     * @param {number} [fadeInTime=0.5] Time in seconds for the music to fade in.
     * @param {number} [fadeOutTime=0.5] Time in seconds for the old music to fade out.
     * @param {boolean} [loop=true] Whether the music should loop.
     */
    async playMusic(audioBuffer, { fadeInTime = 0.5, fadeOutTime = 0.5, loop = true } = {}) {
        this._initContext();

        // If music is already playing, fade it out.
        if (this.musicSource) {
            const oldSource = this.musicSource; // Capture the source to stop it later.
            
            // Schedule the fade-out
            this.musicGainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
            this.musicGainNode.gain.setValueAtTime(this.musicGainNode.gain.value, this.audioContext.currentTime);
            this.musicGainNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + fadeOutTime);

            // Stop the old source after the fade-out is complete.
            await timeout(() => {
                oldSource.stop();
            }, fadeOutTime * 1000 + 10);
        }

        // Reset state for the new track
        this.musicPauseOffset = 0;
        this.currentMusicBuffer = audioBuffer;
        
        // Create and configure the new source
        this.musicSource = this.audioContext.createBufferSource();
        this.musicSource.buffer = this.currentMusicBuffer;
        this.musicSource.loop = loop;
        this.musicSource.connect(this.musicGainNode);

        // Schedule the fade-in for the new track
        // If not fading out, start from 0. Otherwise, start from the current value for a smooth crossfade.
        if (!this.musicSource) {
            this.musicGainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
        }
        this.musicGainNode.gain.linearRampToValueAtTime(1, this.audioContext.currentTime + fadeInTime);
        
        // Start playback
        this.musicSource.start(0, this.musicPauseOffset);
        this.musicStartTime = this.audioContext.currentTime - this.musicPauseOffset;
    }

    /**
     * Stops the currently playing music.
     * @param {number} [fadeOutTime=0] Time in seconds for the music to fade out.
     */
    stopMusic(fadeOutTime = 0) {
        if (!this.musicSource) return;

        this.musicGainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
        this.musicGainNode.gain.setValueAtTime(this.musicGainNode.gain.value, this.audioContext.currentTime);
        this.musicGainNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + fadeOutTime);

        setTimeout(() => {
            if (this.musicSource) {
                this.musicSource.stop();
                this.musicSource = null;
                this.currentMusicBuffer = null;
                this.musicPauseOffset = 0;
            }
        }, fadeOutTime * 1000);
    }

    /**
     * Pauses the currently playing music.
     * @param {number} [fadeOutTime=0] Time in seconds for the music to fade out before pausing.
     */
    pauseMusic(fadeOutTime = 0) {
        if (!this.musicSource) return;

        this.musicPauseOffset = (this.audioContext.currentTime - this.musicStartTime) % this.currentMusicBuffer.duration;
        
        this.musicGainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
        this.musicGainNode.gain.setValueAtTime(this.musicGainNode.gain.value, this.audioContext.currentTime);
        this.musicGainNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + fadeOutTime);

        setTimeout(() => {
            if (this.musicSource) {
                this.musicSource.stop();
                this.musicSource = null; // Mark as not playing
            }
        }, fadeOutTime * 1000);
    }

    /**
     * Gets the current playback position of the music in milliseconds.
     * @returns {number} The current position in milliseconds.
     */
    getPosition() {
        if (!this.currentMusicBuffer) return 0;

        if (this.musicSource) { // It's playing
            return ((this.audioContext.currentTime - this.musicStartTime) % this.currentMusicBuffer.duration) * 1000;
        } else { // It's paused
            return this.musicPauseOffset * 1000;
        }
    }
    
    /**
     * Sets the playback position of the music in milliseconds.
     * @param {number} position The position to seek to in milliseconds.
     */
    setPosition(position) {
        if (!this.currentMusicBuffer) return;
        const wasPlaying = !!this.musicSource;
        const loop = wasPlaying ? this.musicSource.loop : true;

        if (wasPlaying) {
            this.musicSource.stop();
        }
        
        this.musicPauseOffset = position / 1000;
        
        if(wasPlaying) {
            // This effectively restarts the track from the new position
            this.playMusic(this.currentMusicBuffer, 0, loop);
        }
    }


    /**
     * Plays a sound effect. Can be fire-and-forget or controlled.
     * @param {AudioBuffer} audioBuffer The pre-loaded audio buffer for the sound effect.
     * @param {object} [options={}] Optional parameters.
     * @param {boolean} [options.loop=false] Whether the sound should loop.
     * @param {number} [options.timeout=0] The cooldown in milliseconds before this same sound can be played again.
     * @returns {object|null} A controller object with stop(), pause(), and play() methods, or null if the sound is on cooldown.
     */
    playSound(audioBuffer, { loop = false, timeout = 0 } = {}) {
        this._initContext();

        // ⏱️ Check if the sound is currently on a cooldown period.
        if (timeout > 0) {
            const lastPlayedTime = this.soundCooldowns.get(audioBuffer);
            if (lastPlayedTime) {
                const timeSincePlayed = this.audioContext.currentTime - lastPlayedTime;
                // Convert timeout from ms to seconds for comparison
                if (timeSincePlayed < timeout / 1000) {
                    return null; // Return null to indicate the sound was not played
                }
            }
        }
        
        // If we proceed, record the new playback time.
        if (timeout > 0) {
            this.soundCooldowns.set(audioBuffer, this.audioContext.currentTime);
        }

        let source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.loop = loop;

        const gainNode = this.audioContext.createGain();
        source.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        let startTime = 0;
        let pauseOffset = 0;
        let isPlaying = false;

        const play = () => {
            if (isPlaying) return;
            source = this.audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.loop = loop;
            source.connect(gainNode);
            source.start(0, pauseOffset % audioBuffer.duration);
            startTime = this.audioContext.currentTime - pauseOffset;
            isPlaying = true;
        };
        
        play(); // Auto-play on creation

        const controller = {
            stop: (fadeOutTime = 0) => {
                if (!isPlaying) return;
                gainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
                gainNode.gain.setValueAtTime(gainNode.gain.value, this.audioContext.currentTime);
                gainNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + fadeOutTime);
                setTimeout(() => {
                    source.stop();
                    isPlaying = false;
                    pauseOffset = 0; // Stop resets position
                }, fadeOutTime * 1000);
            },
            pause: () => {
                if (!isPlaying) return;
                source.stop();
                isPlaying = false;
                pauseOffset = this.audioContext.currentTime - startTime;
            },
            play: () => play(),
            isPlaying: () => isPlaying,
        };
        
        // For fire-and-forget sounds, they are cleaned up automatically when playback ends
        if (!loop) {
            source.onended = () => { isPlaying = false; };
        }

        return controller;
    }
}