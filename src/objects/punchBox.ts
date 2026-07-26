import Phaser from 'phaser';
import { Switch } from './switches';
import { bodyOverlapsSensor } from '../systems/overlap';

const ARM_FRAME = 193; // arm segment that fills the gap behind the fist while extended
const PUNCH_DURATION_MS = 200;
const KNOCKBACK_MS = 220;
const TILE = 8;

export class PunchBox extends Phaser.GameObjects.Rectangle {
    forceX: number;
    forceY: number;
    isPunching = false;

    dirX: number; // cardinal punch direction, body → fist
    dirY: number;

    // Knockback impulse: force magnitude signed along the punch direction, cross-axis as feel offset.
    private impulseX: number;
    private impulseY: number;

    private linkedSwitch: Switch | null = null;
    private prevPowered = false;
    private punchedTargets = new Set<any>(); // one hit per target per punch cycle
    private enabled = true;                   // armed state; gates whether it can punch at all
    private inRange = new Set<any>();          // edge-tracking for body-touch triggering, per target

    private restX: number;  // the fist's start cell (one tile out from the body)
    private restY: number;
    private bodyX: number;  // the cell the player must touch to trigger
    private bodyY: number;
    private fistSprite: Phaser.GameObjects.Image;
    private armSprite: Phaser.GameObjects.Image;

    constructor(
        scene: Phaser.Scene,
        cx: number, cy: number,
        w: number, h: number,
        fistFrame: number,
        dirX: number,
        dirY: number,
        forceX: number,
        forceY: number,
        startEnabled: boolean
    ) {
        super(scene, cx, cy, w, h, 0xff0000);
        this.setAlpha(0);
        scene.add.existing(this);

        this.forceX = forceX;
        this.forceY = forceY;
        this.dirX = dirX;
        this.dirY = dirY;

        // Sign the travel-axis force to the punch direction; keep the cross axis as a feel offset.
        this.impulseX = dirX !== 0 ? Math.abs(forceX) * dirX : forceX;
        this.impulseY = dirY !== 0 ? Math.abs(forceY) * dirY : forceY;

        this.restX = cx;
        this.restY = cy;
        // Body sits one tile back from the fist's start, opposite the punch direction.
        this.bodyX = cx - dirX * TILE;
        this.bodyY = cy - dirY * TILE;

        // Fist + arm art points right by default; rotate it to match the travel direction.
        const angle = this.directionAngle();

        this.fistSprite = scene.add.image(cx, cy, 'tileSprites', fistFrame)
            .setOrigin(0.5, 0.5).setDepth(50).setAngle(angle).setVisible(false);

        this.armSprite = scene.add.image(cx, cy, 'tileSprites', ARM_FRAME)
            .setOrigin(0.5, 0.5).setDepth(49).setAngle(angle).setVisible(false);

        this.setEnabled(startEnabled);
    }

    // Angle (degrees) that points the right-facing art along the punch direction.
    private directionAngle(): number {
        if (this.dirX > 0) return 0;
        if (this.dirX < 0) return 180;
        if (this.dirY > 0) return 90;  // down
        return -90;                    // up
    }

    linkSwitch(sw: Switch) {
        this.linkedSwitch = sw;
        this.prevPowered = sw.powered;
    }

    setEnabled(enabled: boolean) {
        this.enabled = enabled;
        if (!enabled) this.retract();
    }

    punch() {
        if (this.isPunching || !this.enabled) return;
        this.scene.game.events.emit('sfx-punch');
        this.isPunching = true;
        this.punchedTargets.clear();
        // Fist extends one tile past its start; the arm fills the fist's start cell behind it.
        this.fistSprite.setPosition(this.restX + this.dirX * TILE, this.restY + this.dirY * TILE).setVisible(true);
        this.armSprite.setPosition(this.restX, this.restY).setVisible(true);

        this.scene.time.delayedCall(PUNCH_DURATION_MS, () => this.retract());
    }

    private retract() {
        this.isPunching = false;
        this.fistSprite.setVisible(false);
        this.armSprite.setVisible(false);
    }

    // Single clean impulse per target per punch via a knockback window — applying it every
    // frame would fight the target's own input/friction and cause rubber-banding.
    // The player uses its knockback window; boxes take a plain velocity impulse.
    applyImpulse(target: any) {
        if (this.punchedTargets.has(target)) return;
        this.punchedTargets.add(target);
        if (typeof target.applyKnockback === 'function') {
            target.applyKnockback(this.impulseX, this.impulseY, KNOCKBACK_MS);
        } else {
            target.Body.setVelocityX(this.impulseX);
            if (this.impulseY !== 0) target.Body.setVelocityY(this.impulseY);
        }
    }

    update(player?: any, boxes: any[] = []) {
        if (this.linkedSwitch) {
            const powered = this.linkedSwitch.powered;
            if (powered && !this.prevPowered) this.punch();
            this.prevPowered = powered;
        }

        if (!this.enabled) {
            this.inRange.clear();
            return;
        }

        const targets: any[] = [];
        if (player) targets.push(player);
        for (const b of boxes) if (b.active) targets.push(b);

        const nowInRange = new Set<any>();
        for (const target of targets) {
            const pb = target.Body;

            if (this.overlapsBody(pb)) {
                nowInRange.add(target);
                if (!this.inRange.has(target)) this.punch();
            }

            if (this.isPunching && this.overlapsSpan(pb)) this.applyImpulse(target);
        }
        this.inRange = nowInRange;
    }

    private overlapsBody(pb: { x: number; y: number; width: number; height: number }): boolean {
        return bodyOverlapsSensor(pb, { x: this.bodyX, y: this.bodyY, width: this.width, height: this.height }, 2, 2);
    }

    private overlapsSpan(pb: { x: number; y: number; width: number; height: number }): boolean {
        const hzCx = this.restX + this.dirX * (TILE / 2);
        const hzCy = this.restY + this.dirY * (TILE / 2);
        const isHorizontal = this.dirX !== 0;
        const widthPad = isHorizontal ? 12 : 24;
        const heightPad = isHorizontal ? 24 : 12;
        return bodyOverlapsSensor(pb, { x: hzCx, y: hzCy, width: 0, height: 0 }, widthPad, heightPad);
    }

    destroy(fromScene?: boolean) {
        this.fistSprite?.destroy();
        this.armSprite?.destroy();
        super.destroy(fromScene);
    }
}
