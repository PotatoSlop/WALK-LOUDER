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
    preJumpBoostWindow: number = 250;

    volumeBuffer: {time: number, vol: number}[] = [];

    // ==================================== Params for Movement ====================================
    BASE_MOVEMENT_SPEED: number = 100;
    MAX_SPEED_MULT: number = 3;

    BASE_JUMP: number = -700;
    MAX_JUMP_MULT: number = 1.5;

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

    pushVolumeSample(vol: number) {
        const now = performance.now();
        this.volumeBuffer.push({time: now, vol});
        const cutoff = now - this.preJumpBoostWindow;
        this.volumeBuffer = this.volumeBuffer.filter(s => s.time >= cutoff);
    }

    jump() {
        if (!this.Body.blocked.down && performance.now() - this.lastGroundedTime > this.CoyoteTime) return;
        this.lastGroundedTime = 0;
        this.lastJumpInputTime = 0;
        const peak = this.volumeBuffer.reduce((max, s) => Math.max(max, s.vol), 0);
        const velocity = this.BASE_JUMP * (1 + peak * (this.MAX_JUMP_MULT - 1));
        this.Body.setVelocityY(velocity);
        this.jumpTime = performance.now();
        this.volumeBuffer = [];
    }

    setSpeedMultiplier(multiplier: number) {
        this.Body.setVelocityX(this.Body.velocity.x * multiplier);
    }

    death() {
        this.setPosition(this.levelStartX, this.levelStartY);
        this.Body.setVelocity(0, 0);
    }


}