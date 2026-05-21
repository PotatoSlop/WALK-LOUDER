import Phaser from 'phaser';

export class Player extends Phaser.GameObjects.Rectangle {
    facing: 'right' | 'left' = 'right';
    isJumping: boolean = false;
    isFalling: boolean = false;
    items: string[] = [];
    Body!: Phaser.Physics.Arcade.Body;
    jumpTime: number = 0;
    jumpBoostWindow: number = 150;
    peakVolume: number = 0;

    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y, 40, 60, 0x00ff00);
        scene.add.existing(this);
        scene.physics.add.existing(this);
        this.Body = this.body as Phaser.Physics.Arcade.Body;
        this.Body.setDragY(100);
        this.Body.setCollideWorldBounds(true);
    }

    moveLeft(volume: number) {
        this.facing = 'left';
        const speed = 100 + volume * 300;
        this.Body.setVelocityX(-speed);
    }

    moveRight(volume: number) {
        this.facing = 'right';
        const speed = 100 + volume * 300;
        this.Body.setVelocityX(speed);
    }

    jump() {
        const boostActive = performance.now() - this.jumpTime < this.jumpBoostWindow;
        if (this.Body.blocked.down && !boostActive) {
            this.Body.setVelocityY(-700);
            this.jumpTime = performance.now();
            this.peakVolume = 0;
        }
    }

    applyVocalBoost(volume: number) {
        const age = performance.now() - this.jumpTime;
        if (age > this.jumpBoostWindow) return;
        if (volume > this.peakVolume) {
            this.peakVolume = volume;
            this.Body.setVelocityY(-700 - volume * 400);
        }
    }

    setSpeedMultiplier(multiplier: number) {
        this.Body.setVelocityX(this.Body.velocity.x * multiplier);
    }



}