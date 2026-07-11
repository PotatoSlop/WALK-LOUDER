import Phaser from 'phaser';
import { getSetting } from './settingsManager';

// Post-processing pipeline for the main camera — bloom, barrel distortion,
// saturation, and vignette — plus CSS scanlines on the canvas container.
// Also wires the live `setting-changed` listener so settings-menu toggles
// update the running scene.
export function setupCameraFX(scene: Phaser.Scene): void {
    const cam = scene.cameras.main;

    Phaser.Actions.AddEffectBloom(cam, {
        threshold: 0.3,    // only pixels brighter than this glow (pixel art smears fast at lower values)
        blurRadius: 3,     // how far the glow spreads
        blurSteps: 4,      // blur quality (higher = smoother, slower)
        blendAmount: 0.8,  // bloom strength (lower = subtler)
    });

    const barrelFilter = cam.filters!.external.addBarrel(1.05);
    barrelFilter.active = getSetting('barrelEnabled');

    const colorMatrixFilter = cam.filters!.external.addColorMatrix();
    colorMatrixFilter.colorMatrix.saturate((getSetting('saturation') - 50) / 50);

    cam.filters!.external.addVignette(0.5, 0.5, 0.75, 0.1);

    // Apply saved scanlines state — scoped to the canvas container, not the whole page
    const canvasParent = scene.game.canvas.parentElement;
    if (canvasParent) {
        canvasParent.style.position = 'relative';
        canvasParent.classList.toggle('scanlines-enabled', getSetting('scanlinesEnabled'));
    }

    scene.game.events.on('setting-changed', ({ key, value }: { key: string, value: any }) => {
        if (key === 'saturation') {
            colorMatrixFilter.colorMatrix.saturate((value - 50) / 50);
        }
        if (key === 'barrelEnabled') {
            barrelFilter.active = value;
        }
        if (key === 'scanlinesEnabled') {
            scene.game.canvas.parentElement?.classList.toggle('scanlines-enabled', value);
        }
    });
}
