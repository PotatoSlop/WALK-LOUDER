const STORAGE_KEY = 'walk-louder-settings';

export interface GameSettings {
    saturation: number;  // 0-100, 50 = neutral
    barrelEnabled: boolean;
    scanlinesEnabled: boolean;
    particlesEnabled: boolean;
    bloodMode: boolean;
    deathCounterEnabled: boolean;
    timerCounterEnabled: boolean;
}

const DEFAULTS: GameSettings = {
    saturation: 50,
    barrelEnabled: true,
    scanlinesEnabled: true,
    particlesEnabled: true,
    bloodMode: false,
    deathCounterEnabled: true,
    timerCounterEnabled: false
};

export function loadSettings(): GameSettings {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw ?? '{}');
    return { ...DEFAULTS, ...parsed };
}

export function saveSettings(patch: Partial<GameSettings>): void {
    const current = loadSettings();
    const updated = { ...current, ...patch };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export function getSetting<K extends keyof GameSettings>(key: K): GameSettings[K] {
    return loadSettings()[key];
}

export function setSetting<K extends keyof GameSettings>(key: K, value: GameSettings[K]): void {
    saveSettings({ [key]: value } as Partial<GameSettings>);
}
