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

        if (!inKnockback) {
            if (leftDown && !rightDown) {
                if (player.Body.blocked.left) {
                    // Already blocked (wall or platform) — match the blocker's X velocity
                    // instead of ramming full speed into it. Ramming builds up penetration
                    // that Arcade can resolve on the wrong (Y) axis, sticking the player to
                    // the side. A static wall / vertical platform returns 0, so gravity can
                    // still pull the player down the face.
                    player.facing = 'left';
                    player.Body.setVelocityX(this.getPlatformVelocityBeside('left'));
                } else {
                    player.moveLeft(vol);
                }
            } else if (rightDown && !leftDown) {
                if (player.Body.blocked.right) {
                    player.facing = 'right';
                    player.Body.setVelocityX(this.getPlatformVelocityBeside('right'));
                } else {
                    player.moveRight(vol);
                }
            } else {
                // Neither key is pressed, OR both keys are pressed -> Dont move
                if (player.grounded) {
                    const platVx = this.getPlatformVelocityBelow();
                    const relVx  = player.Body.velocity.x - platVx;
                    player.Body.setVelocityX(platVx + relVx * 0.82);
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
            player.jump(jumpVol);
        }

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
        const isMovingIntent = (leftDown && !rightDown && !player.Body.blocked.left) ||
                            (rightDown && !leftDown && !player.Body.blocked.right);

        if (!isGrounded || justJumped) {
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
        } else {
            player.stop();
            player.setFrame(0);
        }
        player.setFlipX(player.facing === 'left');

        const barScene = this.scene.scene.get('volumeBar') as VolumeBarScene | undefined;
        const tintVol = barScene?.displayedVol ?? 0;
        player.setTint(volumeToTintColor(tintVol));
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

    // Returns the X velocity of a moving platform the player is side-touching on `side`
    // (i.e. vertically overlapping and edge-aligned), or 0 if it's a static wall / vertical
    // platform / nothing. Used by the blocked-input gate so the player rides a horizontally
    // moving platform pressed against them instead of ramming into it.
    private getPlatformVelocityBeside(side: 'left' | 'right'): number {
        const pb = this.player.Body;
        for (const p of this.platformGroup.getChildren()) {
            const platBody = (p as MovingPlatform).Body;
            // Skip if there is no vertical overlap (platform is above or below)
            if (pb.bottom <= platBody.top || pb.top >= platBody.bottom) continue;
            if (side === 'left'  && Math.abs(platBody.right - pb.left)  <= 2) return platBody.velocity.x;
            if (side === 'right' && Math.abs(platBody.left  - pb.right) <= 2) return platBody.velocity.x;
        }
        return 0;
    }
}
