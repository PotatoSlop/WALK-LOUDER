import Phaser from 'phaser';
import { Switch } from './switches';

export class Box extends Phaser.GameObjects.Rectangle {
    Body: Phaser.Physics.Arcade.Body;
    tileSprite: Phaser.GameObjects.Image | null = null;
    private linkedSwitch: Switch | null = null;
    private switchInverted: boolean = false;

    constructor(
        scene: Phaser.Scene,
        x: number, y: number,
        width: number, height: number,
        dragX: number = 300,
        mass: number = 1
    ) {
        super(scene, x, y, width, height, 0x000000);
        scene.add.existing(this);
        scene.physics.add.existing(this, false);
        this.Body = this.body as Phaser.Physics.Arcade.Body;
        this.Body.setCollideWorldBounds(false);
        this.Body.setDragX(dragX);
        this.Body.setMass(mass);
    }

    linkSwitch(sw: Switch, inverted: boolean = false) {
        this.linkedSwitch = sw;
        this.switchInverted = inverted;
    }

    setEnabled(state: boolean) {
        this.setVisible(state);
        this.setActive(state);
        (this.Body as any).enable = state;
        if (this.tileSprite) this.tileSprite.setVisible(state);
    }

    update() {
        if (this.linkedSwitch) {
            const shouldBeEnabled = this.linkedSwitch.powered !== this.switchInverted;
            if (shouldBeEnabled !== this.active) this.setEnabled(shouldBeEnabled);
        }
        // tileSprite uses origin (0,1) — convert center to bottom-left corner
        if (this.tileSprite) this.tileSprite.setPosition(this.x - this.width / 2, this.y + this.height / 2);
    }
}
