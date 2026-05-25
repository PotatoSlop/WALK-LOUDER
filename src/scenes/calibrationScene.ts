import Phaser from 'phaser';
import { micInput } from '../systems/MicInput';

export class CalibrationScene extends Phaser.Scene {
    mic!: micInput;
    private overlay!: HTMLDivElement;
    private instructionEl!: HTMLDivElement;
    private countdownEl!: HTMLDivElement;

    constructor() {
        super({ key: 'calibration' });
    }

    init(data: { mic: micInput }) {
        this.mic = data.mic;
    }

    create() {
        // Match game scene zoom so the dim overlay covers the full view
        this.cameras.main.setZoom(4);

        // Dim background (rendered in game canvas)
        this.add.rectangle(120, 80, 240, 160, 0x000000, 0.75);

        // DOM overlay — renders at native screen resolution
        this.overlay = document.createElement('div');
        this.overlay.id = 'calibration-overlay';
        Object.assign(this.overlay.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            zIndex: '1001',
        });

        this.instructionEl = document.createElement('div');
        Object.assign(this.instructionEl.style, {
            fontFamily: 'monospace',
            fontSize: '18px',
            color: '#ffffff',
            textAlign: 'center',
            whiteSpace: 'pre-line',
            marginBottom: '16px',
        });

        this.countdownEl = document.createElement('div');
        Object.assign(this.countdownEl.style, {
            fontFamily: 'monospace',
            fontSize: '36px',
            color: '#ffff00',
            textAlign: 'center',
        });

        this.overlay.appendChild(this.instructionEl);
        this.overlay.appendChild(this.countdownEl);

        const canvas = this.game.canvas;
        const parent = canvas.parentElement!;
        parent.style.position = 'relative';
        parent.appendChild(this.overlay);

        this.events.on('shutdown', () => this.overlay?.remove());

        this.runCalibration();
    }

    update() {
        const phase = this.mic?.calibrationPhase;
        if (phase === 'noise' || phase === 'peak') {
            const elapsed = performance.now() - this.mic.calibrationStartTime;
            const remaining = Math.max(0, (3000 - elapsed) / 1000);
            this.countdownEl.textContent = remaining.toFixed(1);
        }
    }

    private async runCalibration() {
        this.instructionEl.textContent = 'Stay quiet...\nCalibrating noise floor';
        await this.mic.calibrateNoise();

        this.instructionEl.textContent = 'Make some noise!\nCalibrating peak volume';
        await this.mic.calibratePeak();

        this.instructionEl.textContent = 'Calibration complete!';
        this.countdownEl.textContent = '';

        this.time.delayedCall(1000, () => this.scene.stop());
    }
}
