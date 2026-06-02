import Phaser from 'phaser';
import { getSetting, setSetting } from '../systems/settingsManager';

export class SettingsScene extends Phaser.Scene {
    constructor() {
        super({ key: 'settings' });
    }

    create() {
        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '20px',
            background: 'rgba(0, 0, 0, 0.85)',
            fontFamily: "'Press Start 2P', monospace",
            color: '#ffffff',
            textAlign: 'center',
            pointerEvents: 'auto',
            zIndex: '1001',
        });

        const title = document.createElement('p');
        title.textContent = 'PAUSED';
        Object.assign(title.style, { fontSize: '24px', margin: '0 0 20px 0' });
        overlay.appendChild(title);

        // Sliders
        overlay.appendChild(this.makeSlider('SATURATION', 0, 100, getSetting('saturation'), (v) => {
            setSetting('saturation', v);
            this.game.events.emit('setting-changed', { key: 'saturation', value: v });
        }));

        // Checkboxes
        overlay.appendChild(this.makeCheckbox('PARTICLES', getSetting('particlesEnabled'), (v) => {
            setSetting('particlesEnabled', v);
            this.game.events.emit('setting-changed', { key: 'particlesEnabled', value: v });
        }));

        overlay.appendChild(this.makeCheckbox('BLOOD MODE', getSetting('bloodMode'), (v) => {
            setSetting('bloodMode', v);
            this.game.events.emit('setting-changed', { key: 'bloodMode', value: v });
        }));

        overlay.appendChild(this.makeCheckbox('BARREL DISTORTION', getSetting('barrelEnabled'), (v) => {
            setSetting('barrelEnabled', v);
            this.game.events.emit('setting-changed', { key: 'barrelEnabled', value: v });
        }));

        overlay.appendChild(this.makeCheckbox('SCANLINES', getSetting('scanlinesEnabled'), (v) => {
            setSetting('scanlinesEnabled', v);
            this.game.events.emit('setting-changed', { key: 'scanlinesEnabled', value: v });
        }));

        // Buttons
        const recalibrateBtn = this.makeButton('RECALIBRATE');
        recalibrateBtn.addEventListener('click', () => {
            overlay.remove();
            this.scene.stop();
            this.scene.launch('calibration');
        });
        overlay.appendChild(recalibrateBtn);

        const canvas = this.game.canvas;
        const parent = canvas.parentElement!;
        parent.style.position = 'relative';
        parent.appendChild(overlay);

        this.input.keyboard!.once('keydown-ESC', () => {
            overlay.remove();
            this.scene.stop();
            this.scene.resume('main');
        });

        this.events.on('shutdown', () => overlay?.remove());
    }

    private makeSlider(label: string, min: number, max: number, value: number, onChange: (v: number) => void): HTMLDivElement {
        const wrapper = document.createElement('div');
        Object.assign(wrapper.style, {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            width: '260px',
        });

        const labelEl = document.createElement('span');
        labelEl.textContent = label;
        Object.assign(labelEl.style, {
            fontFamily: "'Press Start 2P', monospace",
            fontSize: '12px',
            color: '#ffffff',
        });

        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(min);
        input.max = String(max);
        input.value = String(value);
        Object.assign(input.style, {
            width: '100%',
            appearance: 'none',
            WebkitAppearance: 'none',
            height: '4px',
            background: 'rgba(255,255,255,0.2)',
            outline: 'none',
            cursor: 'pointer',
            accentColor: '#ffffff',
        });

        input.addEventListener('input', () => onChange(Number(input.value)));

        wrapper.appendChild(labelEl);
        wrapper.appendChild(input);
        return wrapper;
    }

    private makeCheckbox(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLDivElement {
        const wrapper = document.createElement('div');
        Object.assign(wrapper.style, {
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            cursor: 'pointer',
            width: '260px',
        });

        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = checked;
        Object.assign(box.style, {
            width: '16px',
            height: '16px',
            cursor: 'pointer',
            accentColor: '#ffffff',
        });

        const labelEl = document.createElement('span');
        labelEl.textContent = label;
        Object.assign(labelEl.style, {
            fontFamily: "'Press Start 2P', monospace",
            fontSize: '12px',
            color: '#ffffff',
        });

        box.addEventListener('change', () => onChange(box.checked));
        wrapper.appendChild(box);
        wrapper.appendChild(labelEl);
        return wrapper;
    }

    private makeButton(label: string): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.textContent = label;
        Object.assign(btn.style, {
            fontFamily: "'Press Start 2P', monospace",
            fontSize: '14px',
            color: '#ffffff',
            background: 'rgba(255, 255, 255, 0.1)',
            border: '1px solid rgba(255, 255, 255, 0.4)',
            padding: '10px 20px',
            cursor: 'pointer',
            pointerEvents: 'auto',
            borderRadius: '8px',
        });
        btn.addEventListener('mouseenter', () => btn.style.background = 'rgba(255, 255, 255, 0.25)');
        btn.addEventListener('mouseleave', () => btn.style.background = 'rgba(255, 255, 255, 0.1)');
        return btn;
    }
}
