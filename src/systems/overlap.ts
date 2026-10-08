// Shared non-physics overlap detection.
// `moverBody` is an Arcade body (x,y = TOP-LEFT corner). `sensor` is a center-origin
// rectangle (x,y = CENTER, as with Phaser.GameObjects.Rectangle).

export interface Rect { x: number; y: number; width: number; height: number; }

export function bodyOverlapsSensor(moverBody: Rect, sensor: Rect, padX = 0, padY = 0): boolean {
    const hw = sensor.width / 2 + padX;
    const hh = sensor.height / 2 + padY;
    return moverBody.x < sensor.x + hw && moverBody.x + moverBody.width > sensor.x - hw &&
           moverBody.y < sensor.y + hh && moverBody.y + moverBody.height > sensor.y - hh;
}
