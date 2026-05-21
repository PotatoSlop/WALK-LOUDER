import Phaser from 'phaser';
import {GameScene} from './scenes/gameScene';
import {DebugScene} from './scenes/debugScene';
import {CalibrationScene} from './scenes/calibrationScene';

var config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    physics: {
        default: "arcade",
        arcade: {
            gravity: {x: 0, y: 2400 },
            debug: false
        }
    },
    scene: [GameScene, DebugScene, CalibrationScene]
};

var game = new Phaser.Game(config);

