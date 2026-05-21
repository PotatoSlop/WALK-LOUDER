export type Vec2 = { x: number; y: number };

interface LevelObjectBase {
    type: string;
    id?: string;
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface GroundDef          extends LevelObjectBase { type: 'ground'; }
export interface PlatformDef        extends LevelObjectBase { type: 'platform'; }
export interface HazardDef          extends LevelObjectBase { type: 'hazard'; isStatic?: boolean; endPos?: Vec2; speed?: number; mode?: 'auto' | 'driven'; }
export interface KeyDef             extends LevelObjectBase { type: 'key'; keyType: string; }
export interface SwitchDef          extends LevelObjectBase { type: 'switch'; switchType: 'button' | 'lever'; }
export interface DoorDef            extends LevelObjectBase { type: 'door'; isLocked?: boolean; keyType?: string | null; targetLevel: string; }
export interface MovingPlatformDef  extends LevelObjectBase { type: 'movingPlatform'; endPos?: Vec2; speed?: number; mode?: 'auto' | 'driven'; attachedHazards?: { x: number; y: number; w: number; h: number }[]; }

export type LevelObject = GroundDef | PlatformDef | HazardDef | KeyDef | SwitchDef | DoorDef | MovingPlatformDef;

export interface SwitchLink {
    objectId: string;
    switchId: string;
    inverted?: boolean;
}

export interface LevelData {
    id: string;
    spawn: Vec2;
    objects: LevelObject[];
    links?: SwitchLink[];
}
