import { AIModel } from './ai.js';
import { PhysicsEngine } from './engine.js';
import { UIRenderer } from './ui.js';

window.addEventListener('DOMContentLoaded', () => {
    const aiModel = new AIModel();
    const lineGroups = aiModel.getInitialLineGroups();
    const physics = new PhysicsEngine(lineGroups);
    const ui = new UIRenderer('bankCanvas');

    ui.renderLineList(lineGroups);

    // Primary bell path: a real WAV asset. This is more reliable on Safari/iOS
    // than creating the complete sound graph only when the bell event fires.
    const bellAudio = new Audio('./bell.wav');
    bellAudio.preload = 'auto';
    bellAudio.playsInline = true;
    bellAudio.load();

    // Secondary path: Web Audio fallback, unlocked by the START user gesture.
    let audioContext = null;
    let audioUnlocked = false;

    const unlockAudio = async () => {
        if (audioUnlocked) return true;

        let htmlAudioUnlocked = false;
        try {
            const previousVolume = bellAudio.volume;
            bellAudio.volume = 0;
            bellAudio.currentTime = 0;
            await bellAudio.play();
            bellAudio.pause();
            bellAudio.currentTime = 0;
            bellAudio.volume = previousVolume;
            htmlAudioUnlocked = true;
        } catch (error) {
            bellAudio.volume = 1;
            console.warn('HTML audio unlock failed:', error);
        }

        let webAudioUnlocked = false;
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
                audioContext ??= new AudioContextClass();
                if (audioContext.state === 'suspended') {
                    await audioContext.resume();
                }

                // Silent pulse executed inside the START click gesture.
                const oscillator = audioContext.createOscillator();
                const gain = audioContext.createGain();
                gain.gain.value = 0;
                oscillator.connect(gain);
                gain.connect(audioContext.destination);
                oscillator.start();
                oscillator.stop(audioContext.currentTime + 0.01);
                webAudioUnlocked = audioContext.state === 'running';
            }
        } catch (error) {
            console.warn('Web Audio unlock failed:', error);
        }

        audioUnlocked = htmlAudioUnlocked || webAudioUnlocked;
        return audioUnlocked;
    };

    const playWebAudioBell = () => {
        if (!audioContext || audioContext.state !== 'running') return false;

        const now = audioContext.currentTime + 0.01;
        const master = audioContext.createGain();
        master.gain.setValueAtTime(0.85, now);
        master.gain.exponentialRampToValueAtTime(0.0001, now + 2.8);
        master.connect(audioContext.destination);

        [880, 1760, 2640, 3520].forEach((frequency, index) => {
            const oscillator = audioContext.createOscillator();
            const gain = audioContext.createGain();
            const duration = 2.7 / (index + 1);
            const level = 0.24 / (index + 1);

            oscillator.type = index === 0 ? 'sine' : 'triangle';
            oscillator.frequency.setValueAtTime(frequency, now);
            gain.gain.setValueAtTime(level, now);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
            oscillator.connect(gain);
            gain.connect(master);
            oscillator.start(now);
            oscillator.stop(now + duration + 0.05);
        });

        return true;
    };

    const playBellSound = async () => {
        try {
            bellAudio.pause();
            bellAudio.currentTime = 0;
            bellAudio.volume = 1;
            await bellAudio.play();
            return;
        } catch (error) {
            console.warn('WAV bell playback failed; using Web Audio fallback:', error);
        }

        if (!playWebAudioBell()) {
            console.error('Bell playback failed on both audio paths.');
        }
    };

    physics.onBell(() => {
        void playBellSound();
    });

    const controls = {
        start: document.getElementById('btn-start'),
        pause: document.getElementById('btn-pause'),
        reset: document.getElementById('btn-reset'),
        speed: document.getElementById('speedRange'),
        speedValue: document.getElementById('speedVal')
    };

    controls.start?.addEventListener('click', async () => {
        await unlockAudio();
        physics.start();
    });

    controls.pause?.addEventListener('click', () => physics.pause());

    controls.reset?.addEventListener('click', () => {
        bellAudio.pause();
        bellAudio.currentTime = 0;
        physics.reset();
    });

    controls.speed?.addEventListener('input', event => {
        const value = Number.parseFloat(event.target.value);
        physics.setSpeedScale(value);
        if (controls.speedValue) controls.speedValue.textContent = value.toFixed(1);
    });

    let lastTime = performance.now();

    const frame = now => {
        const dt = (now - lastTime) / 1000;
        lastTime = now;

        physics.update(dt);

        const state = physics.getState();
        ui.drawBank();
        ui.drawRiders(state);
        ui.updateUI(state);

        requestAnimationFrame(frame);
    };

    requestAnimationFrame(frame);
});
