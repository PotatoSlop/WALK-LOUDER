# Refactor: modularizing `gameScene.ts`

> **✅ COMPLETED.** All four extractions shipped and verified in-game:
> `src/systems/tiled.ts` (`TiledContext`), `src/systems/levelBuilder.ts` (`LevelBuilder`),
> `src/systems/cameraFX.ts` (`setupCameraFX`), and `src/systems/playerController.ts`
> (`PlayerController`). `gameScene.ts` is now orchestration + game state only.
> This doc is kept as a record of the design and the reasoning behind each seam.
>
> Follow-ups noted during the work (not yet done):
> - `cameraFX.ts` — the `setting-changed` listener is registered on the game-level emitter
>   every `create()`/`scene.restart()`, so handlers accumulate across level transitions.
>   Fix later with a `shutdown`-scoped `off()`. Pre-existing behavior, preserved as-is.

## Goal
`gameScene.ts` is ~1050 lines. Most of it is construction (turning Tiled objects into
game objects) and player physics that happen to live in the scene for convenience. The
aim is to narrow the scene to **game-state orchestration only** and pull everything else
into focused modules — primarily so physics bugs can be debugged in isolation.

**Coupling style:** plain classes that take `scene` in the constructor (matches how
`Player`, `Box`, etc. already work). No Phaser plugins, no mixins.

## What's in the file today

| Concern | Current location | ~Lines |
|---|---|---|
| Level building (tilemap parse → spawn everything) | `spawnInteractable`, `spawnHazard`, `spawnSaw`, `spawnTurret`, `spawnTriggerSpike`, `spawnSwitchDrivenSpike` + gid/type maps | ~450 |
| Tiled/GID utilities | `gidFrame`, `addTileSprite`, `addOrientedTileSprite`, `getTiledProp`, `getObjectType`, `objectGeometry` + GID constants | ~120 |
| Player physics/control | `getPlatformVelocityBelow`, `isPressingIntoPlatform` + movement/jump/friction/anim block of `update()` | ~150 |
| Camera FX / post-processing | bloom, barrel, colormatrix, vignette, scanlines, `setting-changed` listener | ~35 |
| Collision wiring | colliders/overlaps | ~50 |
| **Actual game state** (death, transitions, level switch, pause, UI registry) | scattered | ~120 |

~80% of the file is not game-state.

## Target layout

```
src/
  scenes/
    gameScene.ts          // orchestration + game state only (~180 lines)
  systems/
    tiled.ts              // TiledContext: GID/type/prop helpers          (NEW)
    levelBuilder.ts       // LevelBuilder: tilemap → game objects          (NEW)
    playerController.ts   // PlayerController: movement/jump/physics       (NEW)
    cameraFX.ts           // setupCameraFX: post-processing + settings     (NEW)
    overlap.ts            // (exists)
  objects/ ...            // (unchanged)
```

## Module contracts

### `systems/tiled.ts`
```ts
export class TiledContext {
  constructor(scene: Phaser.Scene, rawJson: any)   // builds firstgids + type/props maps
  gidFrame(gid: number): number
  getTiledProp<T>(obj, name: string): T | undefined
  getObjectType(obj): string | undefined
  objectGeometry(obj): { cx, cy, w, h, rot }
  addTileSprite(gid, x, y, rot?): Phaser.GameObjects.Image
  addOrientedTileSprite(obj, cx, cy, depth?): Phaser.GameObjects.Image
}
```
- Moves: `gameScene.ts:397-485` + GID constants (`gameScene.ts:18-46`).
- No behavior change — mechanical lift.
- **While here:** the flip/rotation matrix logic is duplicated between `addOrientedTileSprite`
  and `spawnTurret`. Extract a single `tiledFlipTransform(H, V, D) => { angle, scaleX, scaleY }`
  helper in this file and call it from both.

### `systems/levelBuilder.ts`
```ts
export interface BuiltLevel {
  player: Player
  spawn: { x: number; y: number }
  groups: {
    platform, hazard, door, item, switch: switchGroup,
    box, punchBox, bullet
  }
}
export class LevelBuilder {
  constructor(scene: Phaser.Scene, map: Phaser.Tilemaps.Tilemap, tiled: TiledContext)
  build(): BuiltLevel
}
```
- Moves: all `spawn*` methods (`gameScene.ts:487-916`), the switch-first ordering pass
  (`223-228`), the platform-slot distribution pass (`230-251`), and the
  `pendingTriggerSpikeStarters` sync mechanism (`260-263`, `728`).
- Scene usage: `const level = new LevelBuilder(this, map, tiled).build();`
- The scene holds `level.groups` and `level.player`.

### `systems/playerController.ts`  ⭐ primary debugging target
```ts
export class PlayerController {
  constructor(scene: Phaser.Scene, player: Player, platformGroup: Phaser.GameObjects.Group)
  update(opts: { vol: number; jumpVol: number; cursors: any; delta: number }): void
  private getPlatformVelocityBelow(): number
  private isPressingIntoPlatform(side: 'left' | 'right'): boolean
}
```
- Moves: `gameScene.ts:372-392` + the movement/jump/friction/animation block of `update()`
  (`944-1021`).
- Everything about *how the player moves* lives here after this. This is where the jump
  buffer, coyote time, knockback window, relative-platform friction, and wall-snag intent
  logic all consolidate.
- Do this extraction **last** — highest behavioral risk.

### `systems/cameraFX.ts`
```ts
export function setupCameraFX(scene: Phaser.Scene): void
```
- Moves: `gameScene.ts:137-169` (bloom, barrel, colormatrix, vignette, scanlines +
  the `setting-changed` listener).
- Isolated, trivial.

## What `gameScene.ts` keeps

- **`create()`**: reads as a setup script —
  build tilemap → `new TiledContext(...)` → `setupCameraFX(this)` →
  `new LevelBuilder(...).build()` → wire colliders → `new PlayerController(...)` →
  launch UI / volumeBar / mic scenes.
- **State it owns**: `deathCt`, `transitioning`, `currentLevelId`, `mapHeightInPixels`.
- **Behavior it owns**: `playerDeath` handler + death FX, `switchLevel`, world-bounds death,
  door-transition overlap, pause/ESC toggle, UI registry writes.
- **`update()`**: read mic volume → `this.playerController.update({ vol, jumpVol, cursors, delta })`
  → dispatch loop over entity groups (`hazard.update()`, `platform.update(delta)`,
  `box.update()`, `switch.tick()` + AABB checks, key pickup, `punchBox.update(player)`).

### ⚠️ Load-bearing: update() execution order
The current `update()` order is:
input/movement → jump → animation → key pickup → switches → hazards → platforms → boxes → punchboxes.

This ordering is **physics-correctness-sensitive** (e.g. platform velocity is read before
platforms move). Keep the order explicit and commented in the scene's `update()`. Do not
let the extraction reorder these calls.

## Collision wiring — leave in the scene
The collider/overlap block (`gameScene.ts:265-314`) references `player`, `platformLayer`,
and every group — it's genuine scene glue. Keep it in `create()` rather than forcing it into
`LevelBuilder` (which would then need `platformLayer` + `player`, muddying its purpose).

## Migration order (ship + verify each independently)
1. **`tiled.ts`** — mechanical, zero behavior change. Safest first.
2. **`cameraFX.ts`** — isolated, trivial.
3. **`levelBuilder.ts`** — depends on `tiled.ts`. Verify every entity type still spawns
   (door, door_top, key, switch, platform, box, spike, trigger_spike, saw, turret, punch_box).
4. **`playerController.ts`** — last. Highest risk (this is the physics). Do it once
   everything else is stable so any regression is attributable to this one change.

## Expected outcome
`gameScene.ts`: ~1050 → ~180 lines. Physics debugging happens in one ~150-line file with
no level-loading noise around it.
