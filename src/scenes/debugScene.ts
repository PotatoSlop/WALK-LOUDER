import Phaser from 'phaser';
import { GameScene } from './gameScene';

export class DebugScene extends Phaser.Scene {
    marker!: Phaser.GameObjects.Rectangle;
    volText!: Phaser.GameObjects.Text;
    posText!: Phaser.GameObjects.Text;
    velText!: Phaser.GameObjects.Text;
    micRawText!: Phaser.GameObjects.Text;
    calibrationText!: Phaser.GameObjects.Text;
    phaseText!: Phaser.GameObjects.Text;

    constructor() {
        super({ key: 'debug' });
    }

    create() {
        this.marker = this.add.rectangle(0, 0, 50, 70, 0xff0000, 0.35);
        this.marker.setStrokeStyle(2, 0xff0000);

        const style: Phaser.Types.GameObjects.Text.TextStyle = {
            fontSize: '14px',
            color: '#ff0000',
            backgroundColor: '#000000aa',
            padding: { x: 6, y: 4 },
        };

        const phaseStyle: Phaser.Types.GameObjects.Text.TextStyle = {
            fontSize: '20px',
            color: '#ffff00',
            backgroundColor: '#000000cc',
            padding: { x: 10, y: 6 },
            align: 'center',
        };
        this.phaseText = this.add.text(400, 300, '', phaseStyle).setOrigin(0.5);

        this.volText = this.add.text(8, 8, '', style);
        this.posText = this.add.text(8, 30, '', style);
        this.velText = this.add.text(8, 52, '', style);
        this.micRawText = this.add.text(8, 74, '', style);
        this.calibrationText = this.add.text(8, 96, '', style);
    }

    update() {
        const gameScene = this.scene.get('main') as GameScene;
        if (!gameScene?.player) return;

        const player = gameScene.player;
        const mic = gameScene.mic;

        this.marker.setPosition(player.x, player.y);

        const vol = mic?.getNormalizedVolume?.() ?? -1;
        const isNan = Number.isNaN(vol);
        this.volText.setText(`vol: ${isNan ? 'NaN!' : vol.toFixed(4)}`);
        if (isNan) this.volText.setColor('#ffff00');

        this.posText.setText(`pos: (${player.x.toFixed(1)}, ${player.y.toFixed(1)})`);

        const vx = player.Body?.velocity?.x ?? 0;
        const vy = player.Body?.velocity?.y ?? 0;
        this.velText.setText(`vel: (${vx.toFixed(1)}, ${vy.toFixed(1)})`);

        const floor = mic?.noiseFloor ?? -1;
        const ceiling = mic?.noiseCeiling ?? -1;
        this.micRawText.setText(`floor: ${floor.toFixed(4)}  ceil: ${ceiling.toFixed(4)}`);

        const range = ceiling - floor;
        this.calibrationText.setText(
            `range: ${range.toFixed(4)}${range <= 0 ? '  BAD (div by zero!)' : ''}`
        );

        const phase = mic?.calibrationPhase ?? 'idle';
        if (phase === 'noise' || phase === 'peak') {
            const elapsed = performance.now() - (mic?.calibrationStartTime ?? 0);
            const remaining = Math.max(0, (3000 - elapsed) / 1000);
            const label = phase === 'noise'
                ? 'CALIBRATING NOISE FLOOR (stay quiet)'
                : 'CALIBRATING PEAK (make noise!)';
            this.phaseText.setText(`${label}\n${remaining.toFixed(1)}s`);
            this.phaseText.setVisible(true);
        } else if (phase === 'done') {
            this.phaseText.setText('CALIBRATION COMPLETE');
            this.phaseText.setVisible(true);
            this.time.delayedCall(1500, () => this.phaseText.setVisible(false));
        } else {
            this.phaseText.setVisible(false);
        }
    }
}
