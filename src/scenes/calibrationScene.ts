import Phaser from 'phaser';
import {micInput} from '../systems/MicInput';

export class CalibrationScene extends Phaser.Scene {
    mic: micInput;
    phase: 'noise-floor' | 'peak' | 'complete' = 'noise-floor';

    constructor() {
        super({key: 'calibration'});
        this.mic = new micInput();
    }

    async calibrate() {
        this.phase = 'noise-floor';
        await this.mic.calibrateNoise();

        this.phase = 'peak';
        await this.mic.calibratePeak();

        this.phase = 'complete';
    }
}

