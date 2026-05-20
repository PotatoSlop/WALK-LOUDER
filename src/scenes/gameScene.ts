import Phaser from 'phaser';
import {OBJECT_TYPES} from '../config/objectTypes';
import {Player} from '../objects/player';
import {micInput} from '../systems/MicInput';

export class GameScene extends Phaser.Scene {

    map: any;
    player: any;
    cursors: any;
    groundGroup: any;
    platformGroup: any;
    hazardGroup: any;
    doorGroup: any;
    itemGroup: any;
    mic: any;

    constructor() {
        super({key: 'main'});
    }

    preload() {
        this.load.json('map', 'assets/data/levels/level-01.json');
    }

    async create() {
        this.mic = new micInput();
        await this.mic.init();
        await this.mic.calibrateNoise();
        await this.mic.calibratePeak();

        const ground = this.add.rectangle(400, 575, 800, 50, OBJECT_TYPES.ground.color);
        this.physics.add.existing(ground, true);

        const platform = this.add.rectangle(400, 400, 200, 20, OBJECT_TYPES.platform.color);
        this.physics.add.existing(platform, true);

        const hazard = this.add.rectangle(600, 525, 20, 50, OBJECT_TYPES.hazard.color);
        this.physics.add.existing(hazard, true);

        const key = this.add.rectangle(400, 350, 30, 30, OBJECT_TYPES.key.color);
        this.physics.add.existing(key, true);

        const door = this.add.rectangle(750, 500, 50, 100, OBJECT_TYPES.door.color);
        this.physics.add.existing(door, true);

        this.player = new Player(this, 100, 500);
        this.physics.add.collider(this.player, ground);
        this.physics.add.collider(this.player, platform);
        
        this.cursors = this.input.keyboard!.createCursorKeys();
        

    }

    update() {
        const vol = this.mic.getNormalizedVolume();

        if (this.cursors.left.isDown) {
            this.player.moveLeft(vol);
        }
        else if (this.cursors.right.isDown) {
            this.player.moveRight(vol);
        }
        else {
            this.player.setSpeedMultiplier(0.8);
        }

        if (this.cursors.up.isDown) {
            this.player.jump();
            console.log('jump');
        }

        // in gameScene update()
        if (this.cursors.up.isUp && this.player.Body.velocity.y < 0) {
            this.player.Body.setVelocityY(this.player.Body.velocity.y * 0.85);
        }

        


    }

}
