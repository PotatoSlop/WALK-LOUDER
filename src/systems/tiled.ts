import Phaser from 'phaser';

export class TiledContext {
    private scene: Phaser.Scene;
    private gidTypeMap: Map<number, string> = new Map();
    private gidDefaultPropsMap = new Map();
    private tilesetFirstgids: number[] = [];

    constructor(scene: Phaser.Scene, rawJSON: any) {
        this.scene = scene;
        
        for (const ts of rawJSON?.tilesets ?? []) {
            const fg: number = ts.firstgid ?? 1;
            this.tilesetFirstgids.push(fg);
            for (const tile of ts.tiles ?? []) {
                const gid = fg + tile.id;
                if (tile.type) this.gidTypeMap.set(gid, tile.type);
                if (tile.properties?.length) this.gidDefaultPropsMap.set(gid, tile.properties);
            }
        }
    }

    // Convert a (flip-stripped) GID to the 0-based Phaser spritesheet frame index.
    // frame = gid - firstgid, NOT gid - 1 (which only works when firstgid === 1).
    public gidFrame(gid: number): number { //unique id for each tile -> maps to sprite tiles & behaviors
        for (let i = this.tilesetFirstgids.length - 1; i >= 0; i--) {
            if (gid >= this.tilesetFirstgids[i]) return gid - this.tilesetFirstgids[i];
        }
        return gid - 1;
    }

    public addTileSprite( // Apply sprite to tiles - bot left corner orgin for tile Objects
        gid: number,        // GID -> Global id of a given tile
        tiledX: number,
        tiledY: number,
        rotation: number = 0
    ): Phaser.GameObjects.Image {
        const img = this.scene.add.image(tiledX, tiledY, 'tileSprites', this.gidFrame(gid));
        img.setOrigin(0, 1);
        if (rotation !== 0) {
            img.setAngle(rotation);
        }
        return img;
    }
        
    // Decode the Tiled flip/rotation flags baked into a tile object into a Phaser
    // transform (same mapping as the turret assembly). Phaser strips the flags out
    // of obj.gid and exposes them as booleans.
    public orientationFromFlips(obj: Phaser.Types.Tilemaps.TiledObject): { angle: number; scaleX: number; scaleY: number } {
        const H = !!obj.flippedHorizontal;
        const V = !!obj.flippedVertical;
        const D = !!obj.flippedAntiDiagonal;
        let angle = 0, scaleX = 1, scaleY = 1;
        if (D) {
            if      ( H && !V) { angle =  90; }
            else if (!H &&  V) { angle = -90; }
            else if (!H && !V) { angle =  90; scaleY = -1; }
            else               { angle = -90; scaleX = -1; }
        } else {
            if      (H && V)   { angle = 180; }
            else if (H)        { scaleX = -1; }
            else if (V)        { scaleY = -1; }
        }
        return { angle, scaleX, scaleY };
    }

    // Render a single tile at a center-origin position, applying the Tiled flip/rotation
    // flags as the orientation (same mapping as the turret assembly).
    public addOrientedTileSprite(obj: Phaser.Types.Tilemaps.TiledObject, cx: number, cy: number, depth: number = 48): Phaser.GameObjects.Image {
        const { angle, scaleX, scaleY } = this.orientationFromFlips(obj);
        // Tiled orientation has TWO independent sources: the flip flags baked into the gid
        // (decoded above) and the object's free `rotation` field (degrees, clockwise). Both
        // must be applied; objectGeometry already centres the tile assuming this rotation.
        const rot = obj.rotation ?? 0;
        const frame = this.gidFrame((obj.gid ?? 1) & 0x1FFFFFFF); // Bitmask rotation data -> frame contains only sprite id data
        return this.scene.add.image(cx, cy, 'tileSprites', frame).setOrigin(0.5, 0.5).setDepth(depth).setAngle(angle + rot).setScale(scaleX, scaleY);
    }
    public getTiledProp<T = any>(
        obj: Phaser.Types.Tilemaps.TiledObject, name: string): T | undefined {
        // Prioritize object's own defined properties
        const prop = obj.properties?.find((p: any) => p.name === name);
        if (prop) return prop.value;
        
        if (obj.gid) { //Default fallback for tile properties 
            const gid = obj.gid & 0x1FFFFFFF;
            const tileProp = this.gidDefaultPropsMap.get(gid)?.find((p: any) => p.name === name);
            if (tileProp) return tileProp.value;
        }
        return undefined;
    }
    public getObjectType(obj: Phaser.Types.Tilemaps.TiledObject): string | undefined {
        if (obj.type) return obj.type;
        const customType = this.getTiledProp<string>(obj, 'type');
        if (customType) return customType;
        if (obj.gid) {
            // Strip Tiled flip flags (high 3 bits) before lookup
            return this.gidTypeMap.get(obj.gid & 0x1FFFFFFF);
        }
        return undefined;
    }
    public objectGeometry(obj: Phaser.Types.Tilemaps.TiledObject) {
        const w = obj.width!;
        const h = obj.height!;
        const rot = obj.rotation ?? 0;
        let cx: number, cy: number;
        if (obj.gid) {
            const rad = rot * Math.PI / 180;
            const cosR = Math.cos(rad);
            const sinR = Math.sin(rad);
            cx = obj.x! + (w / 2) * cosR + (h / 2) * sinR;
            cy = obj.y! + (w / 2) * sinR - (h / 2) * cosR;
        } else {
            cx = obj.x! + w / 2;
            cy = obj.y! + h / 2;
        }
        return { cx, cy, w, h, rot };
    }


}