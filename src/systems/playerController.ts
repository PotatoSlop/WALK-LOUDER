import Phaser from 'phaser';
import { Player } from '../objects/player';
import { MovingPlatform } from '../objects/movingPlatform';
import { VolumeBarScene, volumeToTintColor } from '../scenes/volumeBarScene';

export interface PlayerUpdateOpts {
    vol: number;                                     // EMA-smoothed volume (movement speed)
    jumpVol: number;                                 // instantaneous volume (jump strength)
    cursors: Phaser.Types.Input.Keyboard.CursorKeys;
    delta: number;
}

export class PlayerController {
    private scene: Phaser.Scene;
    private player: Player;
    private platformGroup: Phaser.GameObjects.Group;

    // Last walk animation frame we emitted a footstep for — tracks step transitions.
    private lastFootFrame: number = -1;

    constructor(scene: Phaser.Scene, player: Player, platformGroup: Phaser.GameObjects.Group) {
        this.scene = scene;
        this.player = player;
        this.platformGroup = platformGroup;
    }

    update({ vol, jumpVol, cursors, delta }: PlayerUpdateOpts) {

        const player = this.player;
        const inKnockback = player.inKnockback;
        const leftDown = cursors.left.isDown;
        const rightDown = cursors.right.isDown;
        const wasGrounded = player.grounded;

        if (!inKnockback) {
            if (leftDown && !rightDown) {
                player.facing = 'left';
                // Removed the 'touching' check so overlap sensors (doors) are ignored
                if (player.Body.blocked.left) {
                    player.Body.setVelocityX(this.getPlatformVelocityBeside('left') - 1);
                } else {
                    player.moveLeft(vol);
                }
            } else if (rightDown && !leftDown) {
                player.facing = 'right';
                // Removed the 'touching' check so overlap sensors (doors) are ignored
                if (player.Body.blocked.right) {
                    player.Body.setVelocityX(this.getPlatformVelocityBeside('right') + 1);
                } else {
                    player.moveRight(vol);
                }
            } else {
                // Neither key is pressed -> Use your exact original deceleration math
                if (player.grounded) {
                    player.Body.setVelocityX(player.Body.velocity.x * 0.82);
                } else {
                    player.setSpeedMultiplier(0.97);
                }
            }
        }

        if (player.grounded && performance.now() - player.jumpTime > 100) {
            player.lastGroundedTime = performance.now();
        }

        if (Phaser.Input.Keyboard.JustDown(cursors.up)) {
            player.lastJumpInputTime = performance.now();
        }

        if (performance.now() - player.lastJumpInputTime <= player.JumpBufferTime) {
            if (player.jump(jumpVol)) this.scene.game.events.emit('sfx-jump-start');
        }

        // Variable jump sound: sustains only while the jump key is held down.
        if (cursors.up.isUp) this.scene.game.events.emit('sfx-jump-stop');

        player.applyVocalBoost(jumpVol);

        const boostActive = performance.now() - player.jumpTime < player.jumpBoostWindow;
        if (cursors.up.isUp && player.Body.velocity.y < 0 && !boostActive) {
            const jumpDecay = Math.pow(0.85, delta / 16.66);
            player.Body.setVelocityY(player.Body.velocity.y * jumpDecay);
        }

        //#region Player animation
        const isGrounded = player.grounded;
        const vy = player.Body.velocity.y;
        const vx = Math.abs(player.Body.velocity.x);
        const justJumped = performance.now() - player.jumpTime < 100;
        const isMovingIntent = (leftDown && !rightDown) || (rightDown && !leftDown);

        if (!isGrounded || justJumped) {
            this.lastFootFrame = -1;
            player.anims.timeScale = 1;
            if (vy < 0 || justJumped) {
                player.play('player_jump', true);
            } else {
                player.play('player_fall', true);
            }
        } else if (vx > 5 || isMovingIntent) {
            // Use intent to smooth over the 1-frame velocity drop
            player.play('player_walk', true);
            player.anims.timeScale = (10 + vol * 18) / 10;

            // One footstep per contact frame of the 6-frame walk cycle. Emit on the
            // transition onto a footfall frame so each step fires exactly once.
            const frame = player.anims.currentFrame?.index ?? 0;
            if ((frame === 1 || frame === 4) && frame !== this.lastFootFrame) {
                this.scene.game.events.emit('sfx-walk');
            }
            this.lastFootFrame = frame;
        } else {
            this.lastFootFrame = -1;
            player.stop();
            player.setFrame(0);
        }
        player.setFlipX(player.facing === 'left');

        const barScene = this.scene.scene.get('volumeBar') as VolumeBarScene | undefined;
        const tintVol = barScene?.displayedVol ?? 0;
        player.setTint(volumeToTintColor(tintVol));

        if (player.grounded && !wasGrounded) {
            this.scene.game.events.emit('sfx-jump-stop');
        }
    }

    // Returns the X velocity of the first moving platform directly beneath the
    // player, or 0 if the player is on static ground. Used for relative friction.
    private getPlatformVelocityBelow(): number {
        const pb = this.player.Body;
        for (const p of this.platformGroup.getChildren()) {
            const platBody = (p as MovingPlatform).Body;
            if (pb.right <= platBody.left || pb.left >= platBody.right) continue;
            if (Math.abs(platBody.top - pb.bottom) <= 4) return platBody.velocity.x;
        }
        return 0;
    }

    private getPlatformVelocityBeside(side: 'left' | 'right'): number {
        const pb = this.player.Body;
        for (const p of this.platformGroup.getChildren()) {
            const platBody = (p as MovingPlatform).Body;
            if (pb.bottom <= platBody.top || pb.top >= platBody.bottom) continue;
            if (side === 'left'  && Math.abs(platBody.right - pb.left)  <= 2) return platBody.velocity.x;
            if (side === 'right' && Math.abs(platBody.left  - pb.right) <= 2) return platBody.velocity.x;
        }
        return 0; // Automatically returns 0 for static walls/tiles
    }

    
}
