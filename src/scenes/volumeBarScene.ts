import Phaser from 'phaser';
import { VolumeBar, volumeToTintColor } from '../ui/VolumeBar';
import { micInput } from '../systems/MicInput';

export { volumeToTintColor };

export class VolumeBarScene extends Phaser.Scene {
    private volumeBar!: VolumeBar;

    constructor() {
        super({ key: 'volumeBar' });
    }

    create() {
        const mic = this.game.registry.get('mic') as micInput;
        this.volumeBar = new VolumeBar(this, mic);
        this.events.on('shutdown', () => this.volumeBar?.destroy());
    }

    get displayedVol(): number {
        return this.volumeBar?.displayedVol ?? 0;
    }

    update(_time: number, delta: number) {
        this.volumeBar?.update(delta);
    }
}
