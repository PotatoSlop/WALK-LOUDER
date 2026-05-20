import Phaser from 'phaser';

export class Player extends Phaser.GameObjects.Rectangle {
    facing: 'right' | 'left' = 'right';
    isJumping: boolean = false;
    isFalling: boolean = false;
    items: string[] = [];
    Body!: Phaser.Physics.Arcade.Body;
 

    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y, 40, 60, 0x00ff00);
        scene.add.existing(this);
        scene.physics.add.existing(this);
        this.Body = this.body as Phaser.Physics.Arcade.Body;
        this.Body.setDragY(100);
    }

    moveLeft(volume: number) {
        this.facing = 'left';
        const speed = 100 + volume * 300;
        this.Body.setVelocityX(speed);
    }

    moveRight(volume: number) {
        this.facing = 'right';
        const speed = 100 + volume * 300;
        this.Body.setVelocityX(speed);
    }

    jump() {
        if (this.Body.blocked.down) {
            this.Body.setVelocityY(-700);
        }
    }

    setSpeedMultiplier(multiplier: number) {
        this.Body.setVelocityX(this.Body.velocity.x * multiplier);
    }



}