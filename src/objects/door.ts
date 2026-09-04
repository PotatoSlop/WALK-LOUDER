import Phaser from 'phaser';

export class Door extends Phaser.GameObjects.Rectangle {
    Body!: Phaser.Physics.Arcade.Body;
    keyType: string | null;
    isLocked: boolean;
    targetLevel: string;
    tileSprite: Phaser.GameObjects.Image | null = null;
    topSprite: Phaser.GameObjects.Image | null = null;

    constructor(
        scene: Phaser.Scene,
        x: number, y: number,
        width: number, height: number,
        isLocked: boolean = false,
        keyType: string | null = null,
        targetLevel: string = '' // For level transition doors, the name of the level to load when the player enters
    ) {
        super(scene, x, y, width, height, 0x0000ff);
        scene.add.existing(this);
        scene.physics.add.existing(this, true);
        this.Body = this.body as Phaser.Physics.Arcade.Body;
        this.isLocked = isLocked;
        this.keyType = keyType;
        this.targetLevel = targetLevel;
    }

    open(playerItems: string[]) {
        if (this.isLocked) {
            if (this.keyType && playerItems.includes(this.keyType)) {
                this.isLocked = false;
            }
        }
    }
}
