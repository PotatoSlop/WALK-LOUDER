import Phaser from 'phaser';
import {GameScene} from './scenes/gameScene';
import {VolumeBarScene} from './scenes/volumeBarScene';
import {CalibrationScene} from './scenes/calibrationScene';
import {UIScene} from './scenes/uiScene';

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
    scene: [GameScene, UIScene, VolumeBarScene, CalibrationScene]
};

// Defer until web fonts (Press Start 2P) are loaded — Phaser renders text to
// canvas immediately on create(), so the font must be ready before boot.
document.fonts.ready.then(() => {
    new Phaser.Game(config);
});

