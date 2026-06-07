import Phaser from 'phaser';
import { Switch } from './switches';

// Arm-extension tile — one row below the body on the sheet (frame index).
const ARM_FRAME = 193;
const PUNCH_DURATION_MS = 200;
// How long the player loses horizontal control after being hit, so the impulse
// isn't instantly cancelled by their own input/friction.
const KNOCKBACK_MS = 220;
const TILE = 8;

export class PunchBox extends Phaser.GameObjects.Rectangle {
    forceX: number;
    forceY: number;
    isPunching = false;
    extendDir: number; // -1 = punch left, +1 = punch right (from the tile's H-flip)

    private linkedSwitch: Switch | null = null;
    private prevPowered = false;
    private punchApplied = false; // one hit per punch cycle

    private restX: number;
    private fistSprite: Phaser.GameObjects.Image;
    private arm1Sprite: Phaser.GameObjects.Image;
    private arm2Sprite: Phaser.GameObjects.Image;

    constructor(
        scene: Phaser.Scene,
        cx: number, cy: number,
        w: number, h: number,
        fistFrame: number,
        flipped: boolean,
        forceX: number,
        forceY: number,
        startEnabled: boolean
    ) {
        super(scene, cx, cy, w, h, 0xff0000);
        this.setAlpha(0);
        scene.add.existing(this);

        this.forceX = forceX;
        this.forceY = forceY;
        this.extendDir = flipped ? -1 : 1;
        this.restX = cx;

        // The placed tile IS the fist — keep its art and H-flip exactly as authored in Tiled.
        this.fistSprite = scene.add.image(cx, cy, 'tileSprites', fistFrame)
            .setOrigin(0.5, 0.5).setDepth(50).setFlipX(flipped);

        // Arm segments fill the gap behind the fist as it extends. Match the fist's flip.
        this.arm1Sprite = scene.add.image(cx, cy, 'tileSprites', ARM_FRAME)
            .setOrigin(0.5, 0.5).setDepth(49).setFlipX(flipped).setVisible(false);
        this.arm2Sprite = scene.add.image(cx, cy, 'tileSprites', ARM_FRAME)
            .setOrigin(0.5, 0.5).setDepth(49).setFlipX(flipped).setVisible(false);

        if (!startEnabled) this.setEnabled(false);
    }

    linkSwitch(sw: Switch) {
        this.linkedSwitch = sw;
        this.prevPowered = sw.powered;
    }

    setEnabled(enabled: boolean) {
        this.fistSprite.setVisible(enabled);
        if (!enabled) this.retract();
    }

    punch() {
        if (this.isPunching || !this.fistSprite.visible) return;
        this.isPunching = true;
        this.punchApplied = false;
        // Slide the fist 2 tiles out; fill the two vacated cells with arm segments.
        this.fistSprite.x = this.restX + this.extendDir * 2 * TILE;
        this.arm1Sprite.setPosition(this.restX, this.fistSprite.y).setVisible(true);
        this.arm2Sprite.setPosition(this.restX + this.extendDir * TILE, this.fistSprite.y).setVisible(true);
        this.scene.time.delayedCall(PUNCH_DURATION_MS, () => this.retract());
    }

    private retract() {
        this.isPunching = false;
        this.fistSprite.x = this.restX;
        this.arm1Sprite.setVisible(false);
        this.arm2Sprite.setVisible(false);
    }

    // Called by gameScene while extended and the player overlaps the span. Delivers a
    // single clean impulse per punch via a knockback window — applying it every frame
    // would fight the player's own input/friction and cause rubber-banding.
    applyImpulse(player: any) {
        if (this.punchApplied) return;
        this.punchApplied = true;
        player.applyKnockback(this.forceX, this.forceY, KNOCKBACK_MS);
    }

    update() {
        if (!this.linkedSwitch) return;
        const powered = this.linkedSwitch.powered;
        if (powered && !this.prevPowered) this.punch();
        this.prevPowered = powered;
    }

    destroy(fromScene?: boolean) {
        this.fistSprite?.destroy();
        this.arm1Sprite?.destroy();
        this.arm2Sprite?.destroy();
        super.destroy(fromScene);
    }
}
