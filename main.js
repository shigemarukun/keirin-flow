import { AIModel } from './ai.js';
import { PhysicsEngine } from './engine.js';
import { UIRenderer } from './ui.js';

window.addEventListener('DOMContentLoaded', () => {
    const aiModel = new AIModel();
    const lineGroups = aiModel.getInitialLineGroups();
    const physics = new PhysicsEngine(lineGroups);
    const ui = new UIRenderer('bankCanvas');

    ui.renderLineList(lineGroups);

    let audioContext = null;

    const ensureAudioReady = async () => {
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) return false;

            audioContext ??= new AudioContextClass();
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }

            // Safari / iOS Safari requires the audio graph to be unlocked by a
            // direct user gesture. A silent one-sample pulse makes the later bell
            // callback reliable without producing an audible click.
            const buffer = audioContext.createBuffer(1, 1, audioContext.sampleRate);
            const source = audioContext.createBufferSource();
            const gain = audioContext.createGain();
            gain.gain.value = 0;
            source.buffer = buffer;
            source.connect(gain);
            gain.connect(audioContext.destination);
            source.start();
            return audioContext.state === 'running';
        } catch (error) {
            console.warn('Audio initialization unavailable:', error);
            return false;
        }
    };

    const playBellSound = async () => {
        try {
            const ready = await ensureAudioReady();
            if (!ready || !audioContext) return;

            const now = audioContext.currentTime + 0.02;
            const master = audioContext.createGain();
            master.gain.setValueAtTime(0.9, now);
            master.connect(audioContext.destination);

            [880, 1760, 2640, 3520].forEach((frequency, index) => {
                const oscillator = audioContext.createOscillator();
                const gain = audioContext.createGain();
                const duration = 2.6 / (index + 1);
                const level = 0.22 / (index + 1);

                oscillator.type = index === 0 ? 'sine' : 'triangle';
                oscillator.frequency.setValueAtTime(frequency, now);
                gain.gain.setValueAtTime(level, now);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
                oscillator.connect(gain);
                gain.connect(master);
                oscillator.start(now);
                oscillator.stop(now + duration + 0.05);
            });
        } catch (error) {
            console.warn('Bell sound unavailable:', error);
        }
    };

    physics.onBell(playBellSound);

    const controls = {
        start: document.getElementById('btn-start'),
        pause: document.getElementById('btn-pause'),
        reset: document.getElementById('btn-reset'),
        speed: document.getElementById('speedRange'),
        speedValue: document.getElementById('speedVal')
    };

    controls.start?.addEventListener('click', async () => {
        await ensureAudioReady();
        physics.start();
    });
    controls.pause?.addEventListener('click', () => physics.pause());
    controls.reset?.addEventListener('click', () => physics.reset());
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
