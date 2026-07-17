import Phaser from 'phaser';
import { Switch } from './switches';

export class Box extends Phaser.GameObjects.Rectangle {
    Body: Phaser.Physics.Arcade.Body;
    tileSprite: Phaser.GameObjects.Image | null = null;
    /** Surface friction (0–1). Boxes below MovingPlatform's threshold slide off instead of being carried. */
    friction: number;
    private linkedSwitch: Switch | null = null;
    private switchInverted: boolean = false;

    constructor(
        scene: Phaser.Scene,
        x: number, y: number,
        width: number, height: number,
        dragX: number = 300,
        mass: number = 1,
        friction: number = 0.6
    ) {
        super(scene, x, y, width, height, 0x000000);
        scene.add.existing(this);
        scene.physics.add.existing(this, false);
        this.Body = this.body as Phaser.Physics.Arcade.Body;
        this.Body.setCollideWorldBounds(false);
        this.Body.setDragX(dragX);
        this.Body.setMass(mass);
        this.friction = friction;
    }

    // Called each frame by a MovingPlatform this box is riding. Body.reset keeps the
    // physics body locked to the platform so gravity/drag don't fight the carry.
    syncPosition(x: number, y: number) {
        this.Body.reset(x, y);
        // tileSprite uses origin (0,1) — convert center to bottom-left corner
        if (this.tileSprite) this.tileSprite.setPosition(x - this.width / 2, y + this.height / 2);
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
