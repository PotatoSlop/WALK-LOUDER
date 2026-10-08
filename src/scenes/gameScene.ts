import Phaser from 'phaser';
import { Player } from '../objects/player';
import { micInput } from '../systems/MicInput';
import { Door } from '../objects/door';
import { Hazard } from '../objects/hazards';
import { Key } from '../objects/key';
import { MovingPlatform } from '../objects/movingPlatform';
import { Switch } from '../objects/switches';
import { PunchBox } from '../objects/punchBox';
import { Box } from '../objects/box';
import { Magnet } from '../objects/magnet';
import { bodyOverlapsSensor } from '../systems/overlap';
import { getSetting } from '../systems/settingsManager';
import { LEVEL_NAMES } from '../data/levels';
import { TiledContext } from '../systems/tiled';
import { LevelBuilder } from '../systems/levelBuilder';
import { setupCameraFX, CameraFXHandle } from '../systems/cameraFX';
import { Flip } from '../objects/flip';
import { PlayerController } from '../systems/playerController';
import { GameState, GAMEMODE_CHANGED, GameMode } from '../systems/gameState';
import { SoundManager } from '../systems/soundFX';

// Door unlock visual frames — swapped when a locked door opens
const DOOR_UNLOCKED_GID = 376;      // door body without handle (unlocked visual)
const DOOR_UNLOCKED_TOP_GID = 356;  // top piece paired with the unlocked body

// Camera zoom factor — canvas runs at 960×640, world stays 240×160
const CAMERA_ZOOM = 4;

// How much of a box's width must rest on solid ground for it to hold instead of tipping into a
// gap. Set to half a tile (TILE/2) so the rule is center-of-mass: a box more than half off an
// edge falls, matching how it looks like it should behave. A smaller value (e.g. 2) lets a box
// perch on a thin lip with most of its body overhanging the void, which reads as "clipping".
const BOX_LEDGE_TOLERANCE = 4;
// Extra distance the box is moved PAST the hole's tile boundary when it tips, so it clears the
// tile with margin. Landing a box exactly on the boundary risks Arcade re-counting a
// floating-point sliver (body.right > tile.left by an epsilon) as support — a permanent float.
const BOX_LEDGE_CLEARANCE = 0.5;
// Probe offset for "the tile just left of x": getTileAtWorldXY(x) covers [x, x+tile), so an edge
// probe at a right-hand boundary must step back a hair to land in the tile the box overlaps.
const EPS = 1e-3;
// The ledge nudge below is a position SNAP (up to ~a tile), which reads as a jump. It only exists
// to unstick a box that has come to REST perched on a sliver; a box that is moving horizontally
// (being pushed, or sliding) carries itself off the edge on its own, so snapping it is both
// unnecessary and jarring. Skip the nudge above this horizontal speed. Sits between "at rest"
// (drag zeroes sub-~2.4px/s each step) and the slowest push (~10px/s = the mass floor).
const BOX_LEDGE_MOVING_VEL = 5;
const BOX_FRICTION_SLIP_TOLERANCE = 0.2;
// Manual box-shove tuning (see GameScene.pushBoxes / pushSpeedFor / contactTol).
//
// Push SPEED vs the run's combined mass is a logarithmic decay that asymptotically floors at a
// fraction of walk speed, so heavy boxes and long chains stay usable instead of grinding toward 0
// (the old walkSpeed/mass hyperbola put a mass-20 box at ~5% of walk speed):
//   speed = walkSpeed · [ MIN_FRACTION + (1 − MIN_FRACTION) / (1 + DECAY·ln(mass)) ]
// mass 1 ⇒ full walk speed (ln1=0); mass → ∞ ⇒ MIN_FRACTION·walkSpeed. DECAY sets how fast it
// falls off; MIN_FRACTION is the asymptotic floor. Floor is a FRACTION so it scales with the
// player's current (volume-driven) walk speed rather than pinning heavy boxes to an absolute px/s.
const BOX_PUSH_MIN_FRACTION = 0.25; // heavy boxes/chains never drop below 25% of walk speed
const BOX_PUSH_SPEED_DECAY  = 1;    // ln-decay rate from 100% (mass 1) toward the floor

// Contact/adjacency tolerance (px) scales with the PUSH SPEED, not mass. The tolerance only exists
// to catch contact across a 120fps step: the faster two edges close, the more they travel between
// steps, so faster pushes need a hair more slack. Slower pushes (quiet player, and heavy boxes,
// which move slower via the mass decay above) get TIGHTER, more precise edges — never looser.
// tol = TOL_MAX · pushSpeed / refWalkSpeed, clamped to [MIN, MAX]. Tiles are 8px, so MAX=2 keeps
// edge detection within a quarter tile (the old 4px was a 50% overreach).
const BOX_PUSH_TOL_MAX = 1.5;   // px hard ceiling — ¼ tile at 8px tiles
const BOX_PUSH_TOL_MIN = 0.1; // px floor so contact is still reliably caught at the slowest pushes
// Minimum VERTICAL overlap (px) to treat contact as a side shove rather than a rider/underside
// case. Fixed (not speed-scaled): it's a geometric rider-vs-side discriminator, not a reach.
const BOX_PUSH_VOVERLAP_MIN = 2;

export class GameScene extends Phaser.Scene {

    player: any;
    cursors: any;
    platformGroup: any;
    hazardGroup: any;
    doorGroup: any;
    itemGroup: any;
    switchGroup: any;
    bulletGroup: any;
    punchBoxGroup: any;
    boxGroup: any;
    magnetGroup: any;
    flipGroup: any;
    platformLayer: any;
    mic: any;
    escKey: any;

    private controlsHint!: Phaser.GameObjects.Image;
    private moveLabel!: Phaser.GameObjects.Text;

    private deathCt: number = 0;
    private gameState!: GameState;

    private currentLevelId: string = 'level01';
    private transitioning: boolean = false;
    private debugKey!: Phaser.Input.Keyboard.Key;
    private playerController!: PlayerController;

    private cameraFX!: CameraFXHandle;
    private flipped: boolean = false; // flip hazard - invert color
    private interactableInvert!: Phaser.Filters.ColorMatrix; // filter color inversion

    // Frame sustained sound state flags
    private platformMoving: boolean = false;
    private magnetPulling: boolean = false;
    private sawTravelling: boolean = false;

    constructor() {
        super({ key: 'main' });
    }

    init(data: { levelId?: string }) {
        this.currentLevelId = data.levelId ?? 'level27';
        this.transitioning = false;
        this.deathCt = this.game.registry.get('deathCt') ?? 0;

        this.gameState = this.game.registry.get('gameState') as GameState
            ?? new GameState(this.game.events);
        this.game.registry.set('gameState', this.gameState);
    }

    preload() {
        this.load.tilemapTiledJSON(this.currentLevelId, `assets/data/levels/${this.currentLevelId}.tmj`);
        this.load.image('tiles', 'assets/walk-louder-tile-sheet.png');
        this.load.image('controls-callout', 'assets/Control_callout.png');
        this.load.spritesheet('tileSprites', 'assets/walk-louder-tile-sheet.png', { frameWidth: 8, frameHeight: 8 });
        this.load.spritesheet('player', 'assets/walkter-Sheet.png', { frameWidth: 8, frameHeight: 16 });
        SoundManager.preload(this);
    }

    create() {
        this.escKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

        if (!this.game.registry.get('soundManager')) {
            this.game.registry.set('soundManager', new SoundManager(this));
        }
        // Reset current state of objects hazards on level create/reset
        this.platformMoving = false;
        this.magnetPulling = false;
        this.sawTravelling = false;
        this.flipped = false; //Inverted colors during "flip" hazard

        // Tilemap
        const map = this.make.tilemap({ key: this.currentLevelId });
        const tileset = map.addTilesetImage('walk-louder-tile-sheet', 'tiles');
        const platformLayer = map.createLayer('Tile Layer 1', tileset!);
        this.platformLayer = platformLayer!;

        // Lock camera and world to map bounds
        this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

        // Set world/game state params
        this.physics.world.TILE_BIAS = 8;
        this.physics.world.setFPS(120);
        this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
        this.cameras.main.setZoom(CAMERA_ZOOM);

        this.cameraFX = setupCameraFX(this);

        // Death
        this.events.on('playerDeath', () => {
            if (this.transitioning) return;
            this.transitioning = true;
            this.setFlipped(false);
            this.deathCt++;
            this.game.registry.set('deathCt', this.deathCt);

            const color = getSetting('bloodMode') ? 0xff0000: this.player.tintTopLeft ?? 0xffffff; // default white if no tint + no blood

            this.player.setVisible(false);
            this.player.Body.setVelocity(0, 0);
            (this.player.Body as Phaser.Physics.Arcade.Body).setEnable(false);

            this.game.events.emit('player-death-fx', { x: this.player.x, y: this.player.y, color, cause: this.player.deathCause });

            this.time.delayedCall(500, () => this.switchLevel(this.currentLevelId));
        });

        // Build the level — LevelBuilder owns the groups and spawns the player
        const rawJson = this.cache.tilemap.get(this.currentLevelId)?.data;
        const tiled = new TiledContext(this, rawJson);
        const level = new LevelBuilder(this, map, tiled).build();
        this.player       = level.player;
        this.platformGroup = level.groups.platform;
        this.hazardGroup   = level.groups.hazard;
        this.doorGroup     = level.groups.door;
        this.itemGroup     = level.groups.item;
        this.switchGroup   = level.groups.switch;
        this.boxGroup      = level.groups.box;
        this.punchBoxGroup = level.groups.punchBox;
        this.bulletGroup   = level.groups.bullet;
        this.magnetGroup   = level.groups.magnet;
        this.flipGroup     = level.groups.flip;

        // Apply filters to game layer (level, hazards, interactables, player)
        level.interactableLayer.enableFilters();
        this.interactableInvert = level.interactableLayer.filters!.internal.addColorMatrix();
        this.interactableInvert.colorMatrix.negative();
        this.interactableInvert.active = false;

        // Construct new player with physics collisions to platform group tagged elements
        this.playerController = new PlayerController(this, this.player, this.platformGroup);

        // Player scene-side wiring - control hints
        this.buildControlsHint();
        this.player.Body.onWorldBounds = true;
        this.physics.world.on('worldbounds', (body: Phaser.Physics.Arcade.Body) => {
            if (body.gameObject !== this.player) return;
            if (body.bottom >= this.physics.world.bounds.bottom) this.player.death();
        });

        // Collisions
        this.physics.add.collider(this.player, platformLayer!);
        this.physics.add.collider(this.player, this.platformGroup);
        this.physics.add.collider(this.player, this.boxGroup);
        this.physics.add.collider(this.boxGroup, platformLayer!);
        this.physics.add.collider(this.boxGroup, this.platformGroup, (boxObj, platformObj) => {
            const box = boxObj as Box;
            const platform = platformObj as MovingPlatform;

            // Friction threshold for slipping off moving platform
            if (box.friction < BOX_FRICTION_SLIP_TOLERANCE) { 
                
                // Offset built in Phaser platform sticking with manual displacement -> zero out velocities
                const deltaX = platform.Body.x - platform.Body.prev.x;
                const deltaY = platform.Body.y - platform.Body.prev.y;
                
                box.Body.x -= deltaX;
                if (deltaY !== 0) box.Body.y -= deltaY;
            }
        });
        this.physics.add.collider(this.boxGroup, this.boxGroup);
        platformLayer!.setCollision([42]);

        // Sticking to platforms
        const platforms = this.platformGroup.getChildren() as MovingPlatform[];
        for (const p of platforms) {
            for (const other of platforms) {
                if (p === other) continue;
                
                const pBody = p.Body;
                const oBody = other.Body;
                
                // If 'other' is sitting directly above 'p' -> move object with platform
                if (Math.abs(oBody.bottom - pBody.top) <= 2 && 
                    oBody.right > pBody.left + 2 && 
                    oBody.left < pBody.right - 2) {
                    
                    // Disable inner edges of vertical platform blocks -> removes collison bugs with multi-tile platforms
                    pBody.checkCollision.up = false; 
                    oBody.checkCollision.down = false; 
                }
            }
        }

        for (const h of this.hazardGroup.getChildren()) {
            this.physics.add.overlap(this.player, h, (p, hazard) => {
                // Overlap fires every frame of contact; once a death is queued the level is mid-
                // transition (restart deferred 500ms), so bail to avoid re-emitting the spike sfx
                // ~30×/death and re-triggering death. Mirrors the door handler's guard.
                if (this.transitioning) return;
                // Manual override of player death collisions when riding moving platform/box
                if (this.playerShieldedFromSpikeByBox((hazard as Hazard).body as Phaser.Physics.Arcade.Body)) return;
                this.game.events.emit('sfx-trigger-spike');
                (p as Player).death('spike');
            });
        }

        // Disable magnet body = disable magnet kill
        this.physics.add.overlap(this.player, this.magnetGroup, (p) => (p as Player).death());

        for (const d of this.doorGroup.getChildren()) {
            this.physics.add.overlap(this.player, d, (p, door) => {
                if (this.transitioning) return;

                const doorObj = door as Door;
                const player = p as Player;

                if (doorObj.isLocked) {
                    doorObj.open(player.items);
                    if (!doorObj.isLocked) {
                        doorObj.tileSprite?.setFrame(DOOR_UNLOCKED_GID - 1);
                        doorObj.topSprite?.setFrame(DOOR_UNLOCKED_TOP_GID - 1);
                        this.transitioning = true;
                        this.game.events.emit('sfx-door-win');
                        this.time.delayedCall(500, () => this.switchLevel(doorObj.targetLevel));
                    }
                    return;
                }
                this.transitioning = true;
                this.game.events.emit('sfx-door-win');
                this.switchLevel(doorObj.targetLevel);
                this.game.events.emit('level-changed', doorObj.targetLevel.slice(-2));
            });
        }

        // Bullets destroyed against geometry (not the player) play the wall-hit sound.
        const killBullet = (bullet: any) => {
            this.game.events.emit('sfx-bullet-hit-wall');
            bullet.destroy();
        };
        this.physics.add.collider(this.bulletGroup, platformLayer! || this.player, killBullet);
        this.physics.add.collider(this.bulletGroup, this.platformGroup, killBullet);
        this.physics.add.overlap(this.bulletGroup, this.boxGroup, killBullet);
        this.physics.add.overlap(this.player, this.bulletGroup, p => (p as Player).death('bullet'));

        this.cursors = this.input.keyboard!.createCursorKeys();
        this.debugKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F);

        // Mic 
        if (!this.mic) {
            this.mic = new micInput();
            this.mic.init().then(() => {
                this.game.registry.set('mic', this.mic);
                this.scene.launch('calibration');
            });
        }

        if (this.scene.isActive('volumeBar')) this.scene.stop('volumeBar');
        this.scene.launch('volumeBar');

        // Write initial UI state to the registry before launching UIScene so it
        // can read the correct level and hint on create() without relying on events
        // that may fire before its listener is registered.
        this.game.registry.set('currentLevel', this.currentLevelId.slice(-2));
        this.game.registry.set('levelName', LEVEL_NAMES[this.currentLevelId] ?? '');
        this.game.registry.set('showHint', this.currentLevelId === 'level01' ? 'arrow-keys' : null);

        if (this.scene.isActive('ui')) this.scene.stop('ui');
        this.scene.launch('ui');

        // Run timing + mode side effects. startRun/split are idempotent, so a death-respawn
        // restart resumes cleanly; split dedupes so only genuine level changes are recorded.
        this.gameState.startRun(this.currentLevelId);
        this.gameState.split(this.currentLevelId);

        // React to mode changes in one place. Listener lives on the global emitter (fires even
        // while this scene is paused), so remove it on shutdown to avoid stale-scene callbacks.
        this.game.events.on(GAMEMODE_CHANGED, this.applyMode, this);

        // Sustained loops (saw whir, platform drone, magnet hum) are driven by the update loop,
        // which halts while the scene is paused — so they'd otherwise keep sounding under the
        // pause menu. Pause them with the scene and resume them when gameplay resumes; the loop
        // audio stays in sync with the (frozen) hazard it belongs to. These are scene-local
        // listeners, cleared automatically on shutdown.
        this.events.on(Phaser.Scenes.Events.PAUSE,  () => this.game.events.emit('sfx-pause-loops'));
        this.events.on(Phaser.Scenes.Events.RESUME, () => this.game.events.emit('sfx-resume-loops'));

        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
            this.game.events.off(GAMEMODE_CHANGED, this.applyMode, this);
            // Kill any sustained loops so they don't bleed across the level teardown.
            this.game.events.emit('sfx-stop-loops');
        });

        // Entering (or restarting into) gameplay is always the 'playing' mode.
        this.gameState.set('playing');
        this.applyMode('playing');
    }

    // The single place where a GameMode change turns into scene side effects.
    private applyMode(mode: GameMode) {
        switch (mode) {
            case 'playing':
                if (this.scene.isActive('settings')) this.scene.stop('settings');
                this.scene.resume();
                break;
            case 'paused':
            case 'settings':
                this.scene.pause();
                if (!this.scene.isActive('settings')) this.scene.launch('settings');
                break;
            case 'results':
                // No results screen yet — freeze gameplay; the run clock stops on its own.
                this.scene.pause();
                break;
        }
    }

    private buildControlsHint() {
        const s = 1 / CAMERA_ZOOM;
        this.moveLabel = this.add.text(20, 78, 'Move', {
                fontFamily: '"Press Start 2P"',
                fontSize:   '10px',
                color:      '#c0c0c0',
            })
            .setOrigin(0.5, 1)
            .setScale(s)
            .setAlpha(0.6)
            .setDepth(5)
            .setVisible(this.currentLevelId === 'level01');

        this.controlsHint = this.add
            .image(20, 95, 'controls-callout')
            .setOrigin(0.5, 1)
            .setScale(s)
            .setAlpha(0.6)
            .setDepth(5)
            .setVisible(this.currentLevelId === 'level01');
    }

    // Turn the "flip" effect on/off in one place: the screen-wide colour invert (camera),
    // the DOM volume-bar/mic invert (via the global 'flip-changed' event), and the flag the
    // update loop reads to reverse the mic→movement mapping.
    private setFlipped(on: boolean) {
        if (this.flipped === on) return;
        this.flipped = on;
        this.cameraFX.setInverted(on);
        this.interactableInvert.active = on;
        this.game.events.emit('flip-changed', on);
    }

    switchLevel(levelId: string) {
        this.scene.restart({ levelId });
    }

    // Game loop
    update(_time: number, delta: number) {
        let vol = this.debugKey.isDown ? 0.8 : (this.mic?.smoothedVolume() ?? 0);
        let jumpVol = this.debugKey.isDown ? 0.8 : (this.mic?.getNormalizedVolume() ?? vol);

        // Flip reverses the mic mapping: loud becomes the new quiet, so the louder the player
        // is the SLOWER they move and the LOWER they jump. Both signals are clamped to [0,1],
        // so 1 - v keeps them in range.
        if (this.flipped) {
            vol = 1 - vol;
            jumpVol = 1 - jumpVol;
        }

        if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
            this.game.events.emit('sfx-pause');
            this.gameState.set(this.gameState.isPlaying() ? 'settings' : 'playing');
        }

        this.playerController.update({ vol, jumpVol, cursors: this.cursors, delta });
        this.carryPlayerOnBox();
        this.pushBoxes(vol);

        for (const item of [...this.itemGroup.getChildren()]) {
            const key = item as Key;
            if (!key.active) continue;
            if (bodyOverlapsSensor(this.player.Body, key)) {
                this.player.items.push(key.keyType);
                this.game.events.emit('item-collect');
                key.tileSprite?.destroy();
                key.destroy();
            }
        }

        // Flip hazards toggle the inversion: the first collected flips the game, a second
        // flips it back, and so on. setFlipped drives all the derived state (camera invert,
        // interactable counter-invert, mic mapping) off this single boolean, so !this.flipped
        // is a complete toggle. AABB test (not a physics overlap) so contact never touches the
        // player's ground/jump state — see the note where the other overlaps are registered.
        for (const item of [...this.flipGroup.getChildren()]) {
            const flip = item as Flip;
            if (!flip.active) continue;
            if (bodyOverlapsSensor(this.player.Body, flip)) {
                flip.collect();
                this.game.events.emit('item-collect');
                this.setFlipped(!this.flipped);
            }
        }

        this.switchGroup.getChildren().forEach((s: Phaser.GameObjects.GameObject) => {
            const sw = s as Switch;
            const zone = sw.triggerRect;
            if (bodyOverlapsSensor(this.player.Body, zone)) sw.onOverlap();
            for (const b of this.boxGroup.getChildren()) {
                if (!b.active) continue;
                if (bodyOverlapsSensor((b as Box).Body, zone)) sw.onOverlap();
            }
            sw.tick();
        });
        this.hazardGroup.getChildren().forEach((h: Phaser.GameObjects.GameObject) => (h as Hazard).update());
        this.platformGroup.getChildren().forEach((p: Phaser.GameObjects.GameObject) => (p as MovingPlatform).update(delta));
        this.boxGroup.getChildren().forEach((b: Phaser.GameObjects.GameObject) => (b as Box).update());
        this.applyLedgeTolerance();
        const boxes = this.boxGroup.getChildren() as Box[];
        this.punchBoxGroup.getChildren().forEach((go: Phaser.GameObjects.GameObject) => {
            (go as PunchBox).update(this.player, boxes);
        });

        this.updateMagnets(delta);
        this.updateLoopSounds();
    }

    // Toggle the sustained platform/magnet/saw sounds on state transitions only.
    private updateLoopSounds() {
        const anyPlatformMoving = this.platformGroup.getChildren().some(
            (p: Phaser.GameObjects.GameObject) => {
                const b = (p as MovingPlatform).Body;
                return Math.abs(b.velocity.x) > 0.5 || Math.abs(b.velocity.y) > 0.5;
            });
        if (anyPlatformMoving !== this.platformMoving) {
            this.platformMoving = anyPlatformMoving;
            this.game.events.emit('sfx-platform-move', { moving: anyPlatformMoving });
        }

        const anyMagnetPulling = this.magnetGroup.getChildren().some(
            (m: Phaser.GameObjects.GameObject) => (m as Magnet).pulledThisFrame);
        if (anyMagnetPulling !== this.magnetPulling) {
            this.magnetPulling = anyMagnetPulling;
            this.game.events.emit('sfx-magnet', { active: anyMagnetPulling });
        }

        const anySawTravelling = this.hazardGroup.getChildren().some(
            (h: Phaser.GameObjects.GameObject) => {
                const hz = h as Hazard;
                return hz.isSaw && hz.active && !hz.isStatic &&
                    (Math.abs(hz.Body.velocity.x) > 0.5 || Math.abs(hz.Body.velocity.y) > 0.5);
            });
        if (anySawTravelling !== this.sawTravelling) {
            this.sawTravelling = anySawTravelling;
            this.game.events.emit('sfx-saw', { moving: anySawTravelling });
        }
    }

    // True when a collidable tile occupies the given WORLD point.
    private tileSolidAt(worldX: number, worldY: number): boolean {
        const t = this.platformLayer.getTileAtWorldXY(worldX, worldY);
        return !!(t && t.collides);
    }

    // Push-block ledge tolerance. Runs after the physics step: a box resting on a floor tile by
    // only a sub-pixel sliver (Arcade counts ANY overlap as support, so a box drifts to rest a
    // fraction of a pixel onto a ledge and floats on a corner) is nudged horizontally off that
    // sliver into the hole it's mostly over, so it falls the way it visually should. The box
    // body is never resized — standable/pushable space is unchanged; only a box that is already
    // tipping gets moved, and only into the gap it's overhanging.
    private applyLedgeTolerance() {
        const T = BOX_LEDGE_TOLERANCE;
        for (const b of this.boxGroup.getChildren()) {
            const box = b as Box;
            if (!box.active) continue;
            const bb = box.Body;
            // Only when resting on the tilemap (blocked.down = tile contact, not a platform/box)
            // and not being launched upward.
            if (!bb.blocked.down || bb.velocity.y < -1) continue;
            // Only for boxes at rest: a box moving horizontally (pushed/sliding) leaves the ledge
            // on its own momentum, so the snap-nudge would just be a visible jump. Let it slide.
            if (Math.abs(bb.velocity.x) > BOX_LEDGE_MOVING_VEL) continue;

            const y = bb.bottom + 1;
            // Enough support if solid ground reaches at least T px in from either edge. A tile
            // lookup at world x covers [x, x+tile), so the left-side probe steps back by EPS to
            // ask "is [left, left+T) solid" — otherwise exactly-T support would hold when hanging
            // off a left edge but tip when hanging off a right one.
            if (this.tileSolidAt(bb.left + T - EPS, y) || this.tileSolidAt(bb.right - T, y)) continue;

            // Sliver: figure out which edge still clips a tile. Probe AT the edges (not inset):
            // Arcade counts any positive overlap as support, so a sliver thinner than an inset
            // probe would read as "neither clips" and float forever. Skip the ambiguous cases
            // (bridging a gap with both corners solid, or already fully unsupported with neither).
            const leftTile = this.platformLayer.getTileAtWorldXY(bb.left, y);
            const rightTile = this.platformLayer.getTileAtWorldXY(bb.right - EPS, y);
            const leftClips = !!(leftTile && leftTile.collides);
            const rightClips = !!(rightTile && rightTile.collides);
            if (leftClips === rightClips) continue;

            // Commit the box off the sliver by moving the clipping edge just past the hole's tile
            // boundary (plus BOX_LEDGE_CLEARANCE). Assigning the ABSOLUTE grid position is
            // idempotent: a box punched back up onto the same sliver resolves to the identical
            // position each time, instead of the old relative `+= (T+1)` shove that walked the box
            // sideways on every bounce (the reported "shifts BACK and repeats" graphical jitter).
            //
            // The clearance must not push the FAR edge into the hole's opposite wall: a box as
            // wide as the hole (the common 8px box / 1-tile hole) would clip that wall by C and
            // land on its corner, then get snapped back — ping-ponging forever. So fall back to
            // an exact fit (integer boundaries, no FP sliver), and skip if even that clips (the
            // hole is narrower than the box, so it bridges rather than falls).
            const edge = leftClips ? leftTile!.getRight() : rightTile!.getLeft();
            const dir = leftClips ? 1 : -1;
            const xFor = (c: number) => leftClips ? edge + c : edge - c - bb.width;
            const fits = (x: number) => leftClips
                ? !this.tileSolidAt(x + bb.width - EPS, y) && !this.tileSolidAt(x + bb.width - EPS, bb.bottom - 1)
                : !this.tileSolidAt(x, y) && !this.tileSolidAt(x, bb.bottom - 1);
            let nx = xFor(BOX_LEDGE_CLEARANCE);
            if (!fits(nx)) nx = xFor(0);
            if (!fits(nx) || (nx - bb.x) * dir <= 0) continue;
            bb.x = nx;
            bb.updateCenter();
            // Let it fall this frame rather than waiting for the next contact test.
            bb.blocked.down = false;
            if (bb.velocity.y < 0) bb.velocity.y = 0;
            // Sync the visible sprite to the corrected body THIS frame — Box.update() (which moves
            // the sprite) already ran, and Arcade won't re-sync the transform from the body until
            // the next step, so otherwise the sprite lags the correction by a frame.
            box.syncDisplayFromBody();
        }
    }

    // Manual horizontal shove — the counterpart to carryPlayerOnBox for the SIDE contact. Boxes
    // are permanently non-pushable (see Box constructor), so Arcade never lets the player transfer
    // momentum into a box: walking into one just stops the player dead. To keep boxes movable we
    // drive them ourselves here, which also means NO two-body velocity exchange ever runs — the
    // whole catapult / phase-through class is gone, not just the cases a pushable-toggle guard
    // could catch.
    //
    // Model: when the player presses into a box beside them, set that box's horizontal velocity
    // (and the player's, so they stay in contact instead of being clamped to ~0 by the box wall).
    // The box's own colliders (tilemap, platforms, other boxes, world edge via ledge tolerance)
    // stop it against obstacles for free, because we drive velocity — not position — and let the
    // next physics step resolve it. Speed follows a logarithmic decay in the run's combined mass
    // that floors at BOX_PUSH_MIN_FRACTION of walk speed (see pushSpeedFor), so a lone mass-1 box
    // pushes at full walk speed while heavy boxes and long chains stay usable rather than crawling
    // to ~0. Runs after the step (in update); the velocity takes effect next frame, like the carry.
    private pushBoxes(vol: number) {
        if (this.player.inKnockback) return; // don't fight a punch knockback
        const pressingRight = this.cursors.right.isDown && !this.cursors.left.isDown;
        const pressingLeft  = this.cursors.left.isDown  && !this.cursors.right.isDown;
        if (!pressingRight && !pressingLeft) return;
        const dir = pressingRight ? 1 : -1;

        const pb = this.player.Body;
        const boxes = this.boxGroup.getChildren() as Box[];

        // Matches Player.moveLeft/Right's speed for the current volume; also sizes the contact
        // tolerance (per box, via its own push speed), so compute it before contact detection.
        const walkSpeed = this.player.BASE_MOVEMENT_SPEED
            + vol * this.player.MAX_SPEED_MULT * this.player.BASE_MOVEMENT_SPEED;

        const front = this.frontBox(pb, dir, boxes, walkSpeed);
        if (!front) return;

        // The whole contiguous run of boxes ahead of `front` moves together; combined mass sets
        // the speed so pushing more (or heavier) boxes is slower (logarithmically, with a floor).
        const chain = this.boxChain(front, dir, boxes, walkSpeed);
        let totalMass = 0;
        for (const b of chain) totalMass += b.Body.mass;

        const pushV = dir * this.pushSpeedFor(totalMass, walkSpeed);

        for (const b of chain) b.Body.velocity.x = pushV;
        pb.velocity.x = pushV;
    }

    // Push speed for a run of combined `totalMass` at the player's current `walkSpeed`: a
    // logarithmic decay from full speed (mass 1) asymptotically down to BOX_PUSH_MIN_FRACTION of
    // walk speed. See the constants block for the formula and rationale.
    private pushSpeedFor(totalMass: number, walkSpeed: number): number {
        const decay = 1 / (1 + BOX_PUSH_SPEED_DECAY * Math.log(Math.max(1, totalMass)));
        return walkSpeed * (BOX_PUSH_MIN_FRACTION + (1 - BOX_PUSH_MIN_FRACTION) * decay);
    }

    // Contact/adjacency gap tolerance for a box, proportional to how fast it would be pushed:
    // tol = TOL_MAX · pushSpeed(mass) / refWalkSpeed, clamped to [MIN, MAX]. Faster pushes (light
    // box and/or louder player) get a hair more slack to catch contact across a step; slower pushes
    // (heavy box, quiet player) get tighter edges. refWalkSpeed is the player's max walk speed
    // (mass-1, full volume) so a light box at full tilt maps to exactly TOL_MAX.
    private contactTol(mass: number, walkSpeed: number): number {
        const refWalkSpeed = this.player.BASE_MOVEMENT_SPEED * (1 + this.player.MAX_SPEED_MULT);
        const tol = BOX_PUSH_TOL_MAX * (this.pushSpeedFor(mass, walkSpeed) / refWalkSpeed);
        return Math.min(BOX_PUSH_TOL_MAX, Math.max(BOX_PUSH_TOL_MIN, tol));
    }

    // The box the player is pressing into on `dir`: horizontally adjacent on that side and sharing
    // enough VERTICAL span to be a genuine side contact (a rider on top or a strike from below
    // overlaps by ~0 and is excluded, so it stays a carry/one-sided case, not a shove).
    private frontBox(pb: Phaser.Physics.Arcade.Body, dir: number, boxes: Box[], walkSpeed: number): Box | null {
        let best: Box | null = null;
        let bestGap = Infinity;
        for (const box of boxes) {
            if (!box.active) continue;
            const bb = box.Body;
            const vOverlap = Math.min(pb.bottom, bb.bottom) - Math.max(pb.top, bb.top);
            if (vOverlap <= BOX_PUSH_VOVERLAP_MIN) continue; // rider/underside/no-overlap ⇒ not a side shove
            const tol = this.contactTol(bb.mass, walkSpeed); // slower-pushed (heavier) boxes get tighter edges
            const gap = dir > 0 ? bb.left - pb.right : pb.left - bb.right;
            if (gap < -tol || gap > tol) continue; // not touching on the press side
            if (Math.abs(gap) < bestGap) { bestGap = Math.abs(gap); best = box; }
        }
        return best;
    }

    // Walk the contiguous run of boxes ahead of `front` in `dir` (each adjacent to and vertically
    // overlapping the previous), so a shove drives the whole line. Visited-guarded against cycles.
    private boxChain(front: Box, dir: number, boxes: Box[], walkSpeed: number): Box[] {
        const chain: Box[] = [front];
        const seen = new Set<Box>([front]);
        let current = front;
        for (;;) {
            const cb = current.Body;
            const next = boxes.find(b => {
                if (seen.has(b) || !b.active) return false;
                const nb = b.Body;
                if (nb.bottom <= cb.top || nb.top >= cb.bottom) return false; // no vertical overlap
                const tol = this.contactTol(nb.mass, walkSpeed); // linked box's push speed sets the reach
                const gap = dir > 0 ? nb.left - cb.right : cb.left - nb.right;
                return gap >= -tol && gap <= tol;
            });
            if (!next) break;
            chain.push(next);
            seen.add(next);
            current = next;
        }
        return chain;
    }

    // Carry the player riding on top of a box. Boxes are movable dynamic bodies, so Arcade
    // never transfers their HORIZONTAL motion to a rider on top. The VERTICAL carry is handled for
    // free because boxes are permanently non-pushable (see Box constructor): the one-sided
    // collision conforms the rider to the box's vertical velocity — we must NOT velocity-match the
    // vertical axis by hand, because the contact normal IS vertical, so any manual set feeds
    // straight back through the collision.
    //
    // Here we only handle the horizontal axis, which is perpendicular to the contact and so
    // never feeds back into the box: match the box's velocity so += adds walk-on-top when
    // walking and locks exactly to the box otherwise. Runs after the physics step; the velocity
    // takes effect next frame. Platforms are excluded — their immovable friction already carries
    // riders.
    private carryPlayerOnBox() {
        const pb = this.player.Body;
        if (!(pb.blocked.down || pb.touching.down)) return;

        for (const b of this.boxGroup.getChildren()) {
            const box = b as Box;
            if (!box.active) continue;
            const bb = box.Body;
            // Must horizontally overlap and be resting on the box's top surface.
            if (pb.right <= bb.left || pb.left >= bb.right) continue;
            if (Math.abs(bb.top - pb.bottom) > 4) continue;

            const walking = this.cursors.left.isDown || this.cursors.right.isDown;
            pb.velocity.x = (walking ? pb.velocity.x : 0) + bb.velocity.x;
            break;
        }
    }

    // True when the player is standing on (or fast-falling onto) a box that lies between them
    // and the spike — the box's top surface is at/above the spike's top and it overlaps the
    // spike, so it is physically taking the hit. Used to reject spike overlaps that are really
    // just the player's body momentarily penetrating the box during a hard landing.
    private playerShieldedFromSpikeByBox(spikeBody: Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody): boolean {
        const p = this.player.Body;
        for (const b of this.boxGroup.getChildren()) {
            const box = b as Box;
            if (!box.active) continue;
            const bb = box.Body;
            // Player must horizontally overlap the box and be sitting on top of it (feet at or
            // below the box's surface from a landing, torso still above that surface).
            if (p.right <= bb.left || p.left >= bb.right) continue;
            if (!(p.bottom >= bb.top - 2 && p.top < bb.top)) continue;
            // The box must be between the player and the spike: its top is at/above the spike's
            // top edge and it reaches down into the spike's span.
            if (bb.top <= spikeBody.top + 1 && bb.bottom > spikeBody.top) return true;
        }
        return false;
    }

    private updateMagnets(delta: number) {
        if (this.magnetGroup.getLength() === 0) return;

        const bodies: Phaser.Physics.Arcade.Body[] = [this.player.Body];
        for (const b of this.boxGroup.getChildren()) {
            if (b.active) bodies.push((b as Box).Body);
        }

        // A field tile is blocked by a solid map tile or any moving platform occupying it.
        const blockedAt = (wx: number, wy: number): boolean => {
            const tile = this.platformLayer.getTileAtWorldXY(wx, wy);
            if (tile && tile.collides) return true;
            for (const p of this.platformGroup.getChildren()) {
                const pb = (p as MovingPlatform).Body;
                if (wx >= pb.left && wx <= pb.right && wy >= pb.top && wy <= pb.bottom) return true;
            }
            return false;
        };

        this.magnetGroup.getChildren().forEach((m: Phaser.GameObjects.GameObject) =>
            (m as Magnet).update(bodies, blockedAt, delta));
    }
}
