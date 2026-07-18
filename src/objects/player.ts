import Phaser from 'phaser';

export class Player extends Phaser.GameObjects.Sprite {
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

    // Params for Movement 
    BASE_MOVEMENT_SPEED: number = 40;
    MAX_SPEED_MULT: number = 3;

    BASE_JUMP: number = -180;
    VOCAL_BOOST: number = 95;

    // Coyote Timing / Jump Buffering
    lastGroundedTime: number = 0;
    lastJumpInputTime: number = 0;

    CoyoteTime: number = 150;
    JumpBufferTime: number = this.CoyoteTime;

    constructor(scene: Phaser.Scene, x: number, y: number, items: string[] = []) {
        super(scene, x, y, 'player', 0);
        scene.add.existing(this);
        scene.physics.add.existing(this);
        this.Body = this.body as Phaser.Physics.Arcade.Body;
        this.Body.setSize(6, 14); 
        this.Body.setOffset(1, 2);
        this.Body.setDragY(27);
        this.Body.setCollideWorldBounds(true);
        // Cap velocity so per physics step (at 120fps) displacement stays under the
        // thinnest platform body (8px) — prevents tunneling through moving platforms.
        // Y cap == gravity terminal so fall feel is unchanged; jumps (~-275) sit well under it.
        this.Body.setMaxVelocity(400, 640);
        this.setDepth(100);

        if (!scene.anims.exists('player_walk')) {
            scene.anims.create({
                key: 'player_walk',
                frames: scene.anims.generateFrameNumbers('player', { start: 0, end: 5 }),
                frameRate: 12,
                repeat: -1,
            });
        }
        if (!scene.anims.exists('player_jump')) {
            scene.anims.create({
                key: 'player_jump',
                frames: scene.anims.generateFrameNumbers('player', { start: 6, end: 7 }),
                frameRate: 12,
                repeat: 0,
            });
        }
        if (!scene.anims.exists('player_fall')) {
            scene.anims.create({
                key: 'player_fall',
                frames: scene.anims.generateFrameNumbers('player', { frames: [8] }),
                frameRate: 1,
                repeat: -1,
            });
        }
    }

    get grounded(): boolean {
        return this.Body.blocked.down || this.Body.touching.down;
    }

    moveLeft(volume: number) {
        this.facing = 'left';
        const speed = this.BASE_MOVEMENT_SPEED + (volume * this.MAX_SPEED_MULT * this.BASE_MOVEMENT_SPEED);
        this.Body.setVelocityX(-speed); // Reverted back to the original math
    }

    moveRight(volume: number) {
        this.facing = 'right';
        const speed = this.BASE_MOVEMENT_SPEED + (volume * this.MAX_SPEED_MULT * this.BASE_MOVEMENT_SPEED);
        this.Body.setVelocityX(speed); // Reverted back to the original math
    }

    // Returns true only on the frame a valid jump actually launches, so callers can
    // trigger the (variable) jump sound exactly once per jump.
    jump(volume: number): boolean {
        const boostActive = performance.now() - this.jumpTime < this.jumpBoostWindow;
        if (!this.grounded && performance.now() - this.lastGroundedTime > this.CoyoteTime) return false;
        if (boostActive) return false;
        this.lastGroundedTime = 0;
        this.lastJumpInputTime = 0;
        this.Body.setVelocityY(this.BASE_JUMP - volume * this.VOCAL_BOOST);
        this.jumpTime = performance.now();
        this.peakVolume = 0;
        this.scene.game.events.emit('sfx-jump-start');
        return true;
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

    knockbackUntil: number = 0;

    get inKnockback(): boolean {
        return performance.now() < this.knockbackUntil;
    }

    applyKnockback(vx: number, vy: number, durationMs: number) {
        this.Body.setVelocityX(vx);
        if (vy !== 0) this.Body.setVelocityY(vy);
        this.knockbackUntil = performance.now() + durationMs;
    }

    // Set by death() so the scene's death handler can pick the right sfx (bullet vs. other).
    deathCause: string = 'default';

    death(cause: string = 'default') {
        this.scene.events.emit('playerDeath', cause);
    }


}