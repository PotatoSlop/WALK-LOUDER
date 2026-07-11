import Phaser from 'phaser';

// A collectible key. Deliberately NOT an Arcade physics body — pickup is detected with
// a plain AABB test (see systems/overlap.ts). A physics body here would collide with the
// player and flip its `touching`/`blocked` flags, corrupting ground state (phantom jumps).
export class Key extends Phaser.GameObjects.Rectangle {
    keyType: string;
    tileSprite: Phaser.GameObjects.Image | null = null;

    constructor(scene: Phaser.Scene, x: number, y: number, width: number, height: number, keyType: string) {
        super(scene, x, y, width, height, 0xffdd00);
        scene.add.existing(this);
        this.keyType = keyType;
    }
}
