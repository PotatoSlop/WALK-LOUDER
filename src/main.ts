import Phaser from 'phaser';
import {GameScene} from './scenes/gameScene';
import {DebugScene} from './scenes/debugScene';
import {CalibrationScene} from './scenes/calibrationScene';

var config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width: 960,
    height: 640,
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
    scene: [GameScene, DebugScene, CalibrationScene]
};

var game = new Phaser.Game(config);

