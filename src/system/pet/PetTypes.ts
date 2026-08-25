/** The four pet needs, each a level from 0 (empty) to 100 (full). */
export const PET_STAT_IDS = ["food", "water", "sleep", "affection"] as const;
export type PetStatId = (typeof PET_STAT_IDS)[number];

export type PetLevels = Record<PetStatId, number>;

export interface PetStatInfo {
    id: PetStatId;
    label: string;
    /** HUD ring color */
    color: string;
    /** Storage key of the drain-speed option */
    drainSetting: string;
    drainDefault: string;
}

export const PET_STATS: readonly PetStatInfo[] = [
    { id: "food", label: "Food", color: "#e0a51b", drainSetting: "foodHours", drainDefault: "4 hours" },
    { id: "water", label: "Water", color: "#2a9fc3", drainSetting: "waterHours", drainDefault: "4 hours" },
    { id: "sleep", label: "Sleep", color: "#8d5bd9", drainSetting: "sleepHours", drainDefault: "8 hours" },
    { id: "affection", label: "Affection", color: "#e0569c", drainSetting: "affectionHours", drainDefault: "4 hours" },
];

/** How long a full bar lasts; "Off" disables that need entirely. */
export const DRAIN_CHOICES: readonly { label: string; hours: number | null }[] = [
    { label: "Off", hours: null },
    { label: "2 hours", hours: 2 },
    { label: "4 hours", hours: 4 },
    { label: "8 hours", hours: 8 },
    { label: "12 hours", hours: 12 },
    { label: "24 hours", hours: 24 },
    { label: "2 days", hours: 48 },
    { label: "4 days", hours: 96 },
    { label: "1 week", hours: 168 },
];

export const OFFLINE_MODE_PAUSE = "Stats pause";
export const OFFLINE_MODE_DRAIN = "Stats keep draining";
export const OFFLINE_MODES: readonly string[] = [OFFLINE_MODE_PAUSE, OFFLINE_MODE_DRAIN];

/** Offline drain never pulls a stat below this (unless it already was). */
export const OFFLINE_FLOOR_CHOICES: readonly { label: string; value: number }[] = [
    { label: "0%", value: 0 },
    { label: "10%", value: 10 },
    { label: "20%", value: 20 },
    { label: "30%", value: 30 },
    { label: "50%", value: 50 },
];

/** Hours a stored drain-choice label stands for; unknown values fall back to the default. */
export function drainHoursValue(raw: unknown, fallbackLabel = "4 hours"): number | null {
    const choice = DRAIN_CHOICES.find((c) => c.label === raw)
        ?? DRAIN_CHOICES.find((c) => c.label === fallbackLabel);
    return choice?.hours ?? null;
}

export function offlineFloorValue(raw: unknown): number {
    return OFFLINE_FLOOR_CHOICES.find((c) => c.label === raw)?.value ?? 20;
}

export function clampLevel(value: number): number {
    return Math.max(0, Math.min(100, value));
}

/** A level after `elapsedMs` of linear drain at "full bar lasts `hours`". */
export function drainedLevel(level: number, hours: number | null, elapsedMs: number): number {
    if (hours === null || elapsedMs <= 0) {
        return clampLevel(level);
    }
    return clampLevel(level - (elapsedMs / (hours * 3_600_000)) * 100);
}
