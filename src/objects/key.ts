import Phaser from 'phaser';

export class Key extends Phaser.GameObjects.Rectangle {
    Body!: Phaser.Physics.Arcade.Body;
    keyType: string;

    constructor(scene: Phaser.Scene, x: number, y: number, width: number, height: number, keyType: string) {
        super(scene, x, y, width, height, 0xffdd00);
        scene.add.existing(this);
        scene.physics.add.existing(this, true);
        this.Body = this.body as Phaser.Physics.Arcade.Body;
        this.keyType = keyType;
    }
}