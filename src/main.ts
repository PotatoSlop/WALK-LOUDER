import Phaser from 'phaser';
import {GameScene} from './scenes/gameScene';
import {VolumeBarScene} from './scenes/volumeBarScene';
import {CalibrationScene} from './scenes/calibrationScene';
import {UIScene} from './scenes/uiScene';
import { SettingsScene } from './scenes/settings';
import { initTitlePlacement } from './ui/titlePlacement';

var config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width: 960,
    height: 640,
    backgroundColor: '#0a0a14',
    antialias: false,      // nearest-neighbor filtering — crisp tile edges
    antialiasGL: false,
    roundPixels: false,    // allow sub-pixel positions — smooth movement
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    physics: {
        default: "arcade",
        arcade: {
            gravity: {x: 0, y: 640 },
            debug: false
        }
    },
    scene: [GameScene, UIScene, VolumeBarScene, CalibrationScene, SettingsScene]
};

let game: Phaser.Game | undefined;
let disposeTitle: (() => void) | undefined;

document.fonts.ready.then(() => {
    game = new Phaser.Game(config);
    disposeTitle = initTitlePlacement();
});

// Vite HMR: without this, every hot update re-runs this module and creates ANOTHER
// Phaser.Game — each with its own WebGL context, RAF loop, and (via GameScene) a fresh
// AudioContext + open microphone stream — while the old ones keep running invisibly.
// Browsers cap WebGL (~16) and AudioContexts (~6) per page, so they pile up and drag down
// the whole browser (buffering, freezes), not just the game. Tear the old game down first.
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        const mic = game?.registry.get('mic') as { destroy?: () => void } | undefined;
        mic?.destroy?.();
        game?.destroy(true);
        game = undefined;
        disposeTitle?.();
        disposeTitle = undefined;
    });
}

