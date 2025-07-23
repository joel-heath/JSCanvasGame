const music = {
    'house1': 'https://cdn.pixabay.com/download/audio/2021/11/23/audio_64b2dd1bce.mp3?filename=just-relax-11157.mp3',
    'outdoors1': 'https://cdn.pixabay.com/download/audio/2024/06/20/audio_c4397b8dad.mp3?filename=peaceful-piano-background-music-218762.mp3'
};

const sfx = {
    door: 'sfx/216006__palkonimo__door_open.wav',
    quack: 'sfx/754978__mastersoundboy2005__generic-duck-quack-sound-effect.wav_trimmed.wav'
};

/**
 * Loads all audio files defined in the music and sfx objects.
 * @param {AudioEngine} audioEngineInstance The instance of the audio engine.
 * @returns {Promise<void>} A promise that resolves when all sounds are loaded.
 */
async function loadSounds(audioEngineInstance) {
    audioEngineInstance._initContext(); // Ensure context is ready for decoding
    const context = audioEngineInstance.audioContext;

    const soundObjects = [music, sfx];
    const promises = [];

    console.log("Starting audio asset loading...");

    for (const soundObject of soundObjects) {
        for (const key in soundObject) {
            if (Object.hasOwnProperty.call(soundObject, key)) {
                const path = soundObject[key];
                const promise = fetch(path)
                    .then(response => response.arrayBuffer())
                    .then(arrayBuffer => context.decodeAudioData(arrayBuffer))
                    .then(audioBuffer => {
                        soundObject[key] = audioBuffer; // Replace path with loaded buffer
                        console.log(`Loaded: ${key}`);
                    })
                    .catch(error => console.error(`Failed to load ${key} from ${path}:`, error));
                promises.push(promise);
            }
        }
    }

    await Promise.all(promises);
    console.log("✅ All audio assets loaded successfully!");
}

let audioEngine;

document.addEventListener('DOMContentLoaded', () => {
    audioEngine = new AudioEngine();
});
