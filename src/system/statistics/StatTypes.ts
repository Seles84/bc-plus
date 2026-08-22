/** A snapshot of collected statistics - the shape stored, displayed and sent to viewers. */
export interface StatsSnapshot {
    /** Unix ms timestamp collection (re)started. */
    since: number;
    /** Total tracked play time in ms. */
    play: number;
    /** Time spent in each tracked state, ms keyed by state id. */
    states: Record<string, number>;
    /** Time spent wearing each item, ms keyed by the item's display name. */
    items: Record<string, number>;
    /** Rule violations (triggers + blocked attempts) keyed by rule id. */
    rules: Record<string, number>;
    /** Event counters keyed by counter id. */
    counters: Record<string, number>;
}

/** Display labels for tracked states, in presentation order. */
export const STATE_LABELS: readonly { id: string; label: string }[] = [
    { id: "room", label: "In a chat room" },
    { id: "helpless", label: "Unable to use hands" },
    { id: "restrained", label: "Restrained" },
    { id: "gagged", label: "Gagged" },
    { id: "blind", label: "Blindfolded" },
    { id: "deaf", label: "Deafened" },
    { id: "chaste", label: "In chastity" },
    { id: "plugged", label: "Plugged" },
    { id: "kneeling", label: "Kneeling" },
    { id: "suspended", label: "Suspended" },
    { id: "enclosed", label: "Enclosed" },
    { id: "edged", label: "Kept on edge" },
    { id: "welded", label: "Collar welded" },
    { id: "punished", label: "Under punishment" },
];

/** Display labels for event counters, in presentation order. */
export const COUNTER_LABELS: readonly { id: string; label: string }[] = [
    { id: "violations", label: "Rules violated" },
    { id: "blocked", label: "Attempts blocked by rules" },
    { id: "curses", label: "Curse enforcements" },
    { id: "punishments", label: "Punishments received" },
    { id: "orgasms", label: "Orgasms" },
    { id: "ruined", label: "Ruined orgasms" },
    { id: "messages", label: "Chat messages sent" },
    { id: "whispers", label: "Whispers sent" },
    { id: "emotes", label: "Emotes sent" },
];

/** Cap on distinct items tracked; once full, only known items keep accumulating. */
export const ITEM_TIME_MAX_KEYS = 300;

/** Caps applied to snapshots received from other players. */
export const REMOTE_MAP_CAPS = { states: 50, items: ITEM_TIME_MAX_KEYS, rules: 300, counters: 50 } as const;

export function formatStatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms < 1000) {
        return "0m";
    }
    const totalMinutes = Math.floor(ms / 60_000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) {
        return `${days}d ${hours}h`;
    }
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    if (totalMinutes > 0) {
        return `${minutes}m`;
    }
    return `${Math.floor(ms / 1000)}s`;
}

/** Keeps only string keys with finite non-negative number values, capped in size. */
export function sanitizeStatMap(value: unknown, maxKeys: number): Record<string, number> {
    const clean: Record<string, number> = {};
    if (typeof value !== "object" || value === null) {
        return clean;
    }
    let kept = 0;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (kept >= maxKeys) {
            break;
        }
        if (typeof entry === "number" && Number.isFinite(entry) && entry >= 0 && key.length <= 100) {
            clean[key] = entry;
            kept++;
        }
    }
    return clean;
}
