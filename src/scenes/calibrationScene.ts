import Phaser from 'phaser';
import {micInput} from '../systems/MicInput';

export class CalibrationScene extends Phaser.Scene {
    mic!: micInput;
    instructionText!: Phaser.GameObjects.Text;
    countdownText!: Phaser.GameObjects.Text;

    constructor() {
        super({key: 'calibration'});
    }

    init(data: {mic: micInput}) {
        this.mic = data.mic;
    }

    create() {
        this.add.rectangle(400, 300, 800, 600, 0x000000, 0.75);

        this.instructionText = this.add.text(400, 260, '', {
            fontSize: '26px',
            color: '#ffffff',
            align: 'center',
        }).setOrigin(0.5);

        this.countdownText = this.add.text(400, 340, '', {
            fontSize: '52px',
            color: '#ffff00',
            align: 'center',
        }).setOrigin(0.5);

        this.runCalibration();
    }

    update() {
        const phase = this.mic?.calibrationPhase;
        if (phase === 'noise' || phase === 'peak') {
            const elapsed = performance.now() - this.mic.calibrationStartTime;
            const remaining = Math.max(0, (3000 - elapsed) / 1000);
            this.countdownText.setText(remaining.toFixed(1));
        }
    }

    private async runCalibration() {
        this.instructionText.setText('Stay quiet...\nCalibrating noise floor');
        await this.mic.calibrateNoise();

        this.instructionText.setText('Make some noise!\nCalibrating peak volume');
        await this.mic.calibratePeak();

        this.instructionText.setText('Calibration complete!');
        this.countdownText.setText('');

        this.time.delayedCall(1000, () => this.scene.stop());
    }
}
