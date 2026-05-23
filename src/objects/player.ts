import Phaser from 'phaser';

export class Player extends Phaser.GameObjects.Rectangle {
    facing: 'right' | 'left' = 'right';
    isJumping: boolean = false;
    isFalling: boolean = false;
    items: string[] = [];
    Body!: Phaser.Physics.Arcade.Body;

    levelStartX: number = 100;
    levelStartY: number = 500;

    jumpTime: number = 0;
    jumpBoostWindow: number = 150;
    peakVolume: number = 0;

    // ==================================== Params for Movement ====================================
    BASE_MOVEMENT_SPEED: number = 100;
    MAX_SPEED_MULT: number = 3;

    BASE_JUMP: number = -500;
    VOCAL_BOOST: number = 400;

    // Coyote Timing / Jump Buffering
    lastGroundedTime: number = 0;
    lastJumpInputTime: number = 0;

    CoyoteTime: number = 150;
    JumpBufferTime: number = this.CoyoteTime;

    constructor(scene: Phaser.Scene, x: number, y: number, items: string[] = []) {
        super(scene, x, y, 40, 60, 0x00ff00);
        scene.add.existing(this);
        scene.physics.add.existing(this);
        this.Body = this.body as Phaser.Physics.Arcade.Body;
        this.Body.setDragY(100);
        this.Body.setCollideWorldBounds(true);
        this.setDepth(100);
    }

    moveLeft(volume: number) {
        this.facing = 'left';
        const speed = this.BASE_MOVEMENT_SPEED + (volume * this.MAX_SPEED_MULT * this.BASE_MOVEMENT_SPEED)
        this.Body.setVelocityX(-speed);
    }

    moveRight(volume: number) {
        this.facing = 'right';
        const speed = this.BASE_MOVEMENT_SPEED + (volume * this.MAX_SPEED_MULT * this.BASE_MOVEMENT_SPEED);
        this.Body.setVelocityX(speed);
    }

    jump() {
        const boostActive = performance.now() - this.jumpTime < this.jumpBoostWindow;
        if (!this.Body.blocked.down && performance.now() - this.lastGroundedTime > this.CoyoteTime) return;
        if (boostActive) return;
        this.lastGroundedTime = 0;
        this.lastJumpInputTime = 0;
        this.Body.setVelocityY(this.BASE_JUMP);
        this.jumpTime = performance.now();
        this.peakVolume = 0;
    }

    applyVocalBoost(volume: number) {
        const age = performance.now() - this.jumpTime;
        if (age > this.jumpBoostWindow) return;
        if (volume > this.peakVolume) {
            this.peakVolume = volume;
            this.Body.setVelocityY(this.BASE_JUMP - volume * this.VOCAL_BOOST);
        }
    }

    setSpeedMultiplier(multiplier: number) {
        this.Body.setVelocityX(this.Body.velocity.x * multiplier);
    }

    death() {
        this.setPosition(this.levelStartX, this.levelStartY);
        this.Body.setVelocity(0, 0);
    }


}