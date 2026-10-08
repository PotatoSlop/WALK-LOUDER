# WALK LOUDER
## Project Statement 
WALK LOUDER is a voice/microphone controlled 2D web-based platformer in which a player must navigate each level with WASD/Arrow key controls and movement magnitudes dictated by the volume of their mic input--the louder they are, the faster/further they travel. Along the way, the player must avoid kill conditions and obstacles, else they reset to the beginning

- Synth/Retro Atari style
- minimal UI/gameplay
- dark, neon color scheme
- approx. 30 min target play time
- inuitive controls

## Frameworks and Technologies
    Game Engine: Phaser
    Build Tool/Bundler: Vite
    Language: Typescript
    UI: HTML/CSS
    Deployment: Itch.io/custom domain -> TBD
    Leaderboard Auth: SilentWolf for speedruns, streamers, etc. -> TBD
    Media encoding/Sharing: FFmpeg.wasm -> Convert files

## Architecture

### Core features: 
- WASD player controls
- gravity, coyote jump, jump buffer
- minimal sound effects
- vector/canvas graphics
- UI layer (potential stats, menus, etc.)
- Level platforms
- level hazzards

### Level Design:
- Physics property/collisions
- tilemap system for rapid design
- store level data locally (JSON?) -> on startLevel(int: level_number) -> load level data
- door object:
  - add onEntry condition for player detection -> move to next level state

### Player Controller:
- Movement controlled via phaser character controller
- player states:
  - alive: bool
  - isFalling: bool
  - facing: bool (string boolean for readability OR 'isFacingRight')
  - velocity: vector2()
- Volume -> Web volume API -> getMedia() for mic input
  - Consider adding tensorflow keyword detection for FULL microphone input control

### GUI:
- Volume meter w/ peak readings
- Pause Menu
  - Callibration settings, Play mode(?)
    - Callibrate input volume -> sample noise floor & peak ceiling
    - normalize values to 0-1 scale -> use for noise detection
- Level indicator
- Main menu
  - Level selector: CSS grid w/ buttons
- Consider a recording/replay system -> MediaStream API
  - capture audio and gameplay as .webm file -> run FFmpeg.wasm -> convert to mp4
  ->  quick share to media platforms
  - Use for speedrun clips/expanding virality
  - SilentWolf for leaderboard auth


## Planned File Structure:

```
walk-louder/
├── public/
│   └── assets/
│       ├── tilemaps/         # .json tilemap files (Tiled editor output)
│       ├── sprites/          # spritesheets, tilesets
│       └── audio/            # sfx
├── src/
│   ├── main.ts               # Phaser.Game config object + boots first scene
│   ├── scenes/
│   │   ├── BootScene.ts      # minimal asset load (loading bar assets)
│   │   ├── PreloadScene.ts   # load all game assets
│   │   ├── MainMenuScene.ts
│   │   ├── GameScene.ts      # core gameplay loop
│   │   └── PauseScene.ts     # runs on top of GameScene (Phaser scene stacking)
│   ├── objects/              # Phaser GameObject subclasses
│   │   ├── Player.ts
│   │   ├── Platform.ts
│   │   ├── Hazard.ts
│   │   └── Door.ts
│   ├── systems/              # pure logic, no Phaser coupling
│   │   ├── MicInput.ts       # Web Audio API wrapper → normalized 0-1 volume
│   │   └── LevelManager.ts   # loads level JSON, calls startLevel(n)
│   ├── ui/
│   │   ├── VolumeMeter.ts    # DOM overlay or Phaser Graphics object
│   │   └── HUD.ts
│   └── data/
│       └── levels/
│           ├── level-01.json
│           └── level-02.json
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```



