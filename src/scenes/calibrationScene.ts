import Phaser from 'phaser';
import { micInput } from '../systems/MicInput';
import { VolumeBar } from '../ui/VolumeBar';

export class CalibrationScene extends Phaser.Scene {
    private mic!: micInput;
    private volumeBar!: VolumeBar;
    private overlay!: HTMLDivElement;
    private instructionEl!: HTMLDivElement;
    private countdownEl!: HTMLDivElement;

    constructor() {
        super({ key: 'calibration' });
    }

    create() {
        this.mic = this.game.registry.get('mic') as micInput;

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
            background: 'rgba(0, 0, 0, 0.75)',
            pointerEvents: 'none',
            zIndex: '1002',
        });

        this.instructionEl = document.createElement('div');
        Object.assign(this.instructionEl.style, {
            fontFamily: "'Press Start 2P', monospace",
            fontSize: '18px',
            color: '#ffffff',
            textAlign: 'center',
            whiteSpace: 'pre-line',
            marginBottom: '16px',
        });

        this.countdownEl = document.createElement('div');
        Object.assign(this.countdownEl.style, {
            fontFamily: "'Press Start 2P', monospace",
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

        this.volumeBar = new VolumeBar(this, this.mic);

        this.events.on('shutdown', () => {
            this.overlay?.remove();
            this.volumeBar?.destroy();
            if (this.scene.isPaused('main')) this.scene.resume('main');
        });

        this.runCalibration();
    }

    update(_time: number, delta: number) {
        const phase = this.mic?.calibrationPhase;
        if (phase === 'noise' || phase === 'peak') {
            const elapsed = performance.now() - this.mic.calibrationStartTime;
            const remaining = Math.max(0, (3000 - elapsed) / 1000);
            this.countdownEl.textContent = remaining.toFixed(1);
        }
        this.volumeBar?.update(delta);
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
