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
        this.volumeBar = new VolumeBar(this, null);

        this.game.registry.events.on('changedata-mic', (_: any, m: micInput) => {
            this.volumeBar?.setMic(m);
        }, this);

        const mic = this.game.registry.get('mic') as micInput | null ?? null;
        if (mic) this.volumeBar.setMic(mic);

        // The "flip" hazard toggles the screen-wide colour invert; mirror it onto the DOM
        // volume bar + mic icon (which the camera filter can't reach).
        this.game.events.on('flip-changed', this.onFlipChanged, this);

        this.events.once('shutdown', () => {
            this.game.registry.events.off('changedata-mic', undefined, this);
            this.game.events.off('flip-changed', this.onFlipChanged, this);
            this.volumeBar?.destroy();
        });
    }

    private onFlipChanged(on: boolean) {
        this.volumeBar?.setFlipped(on);
    }

    get displayedVol(): number {
        return this.volumeBar?.displayedVol ?? 0;
    }

    update(_time: number, delta: number) {
        // Belt-and-suspenders: if the registry event was missed (timing edge case),
        // poll until the mic lands in the registry.
        if (this.volumeBar && !this.volumeBar.hasMic) {
            const mic = this.game.registry.get('mic');
            if (mic) this.volumeBar.setMic(mic);
        }
        this.volumeBar?.update(delta);
    }
}
