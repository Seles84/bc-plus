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

// ------------------------------------------------------------------ Gains

/** Eating/drinking from a pet bowl restores this much (points of 100). */
export const BOWL_RECOVERY = 67;
/** Consuming a food/drink item (fed or held) restores this much. */
export const ITEM_RECOVERY = 33;

/**
 * Activities whose use on the pet's mouth counts as eating/drinking beyond
 * BC's own Needs-EatItem/Needs-SipItem prerequisites: other mods' well-known
 * feeding activities (LSCG, Luzi, MPA's pet bowls), matched by name only -
 * none of those mods is required for this to work.
 */
export const FOOD_ACTIVITY_NAMES: readonly string[] = [
    "LSCG_Eat", "ThrowItem", "吃掉嘴里食物_Luzi", "MPA_BowlEat", "MPA_BowlEat2",
];
export const WATER_ACTIVITY_NAMES: readonly string[] = [
    "LSCG_FunnelPour", "LSCG_Quaff", "MPA_BowlDrink", "MPA_BowlDrink2",
];
/** Our own bowl activities (registered as BC custom activities). */
export const BCP_BOWL_EAT = "BCP_BowlEat";
export const BCP_BOWL_DRINK = "BCP_BowlDrink";

/** Activities that raise affection when done TO the pet, by warmth tier. */
export const AFFECTION_LOVE_ACTIVITIES: readonly string[] = [
    "Pet", "TakeCare", "Caress", "Cuddle", "LSCG_Nuzzle", "LSCG_Hug",
];
export const AFFECTION_LIKE_ACTIVITIES: readonly string[] = [
    "Kiss", "FrenchKiss", "Lick", "Nibble", "MassageHands", "MassageFeet", "Grope", "Scratch",
];
/** Rough treatment: lowers affection, unless the pet is a masochist. */
export const AFFECTION_ROUGH_ACTIVITIES: readonly string[] = [
    "Spank", "Slap", "Bite", "Pinch", "Pull", "ShockItem", "SpankItem", "Whip",
];
export const AFFECTION_LOVE_GAIN = 5;
export const AFFECTION_LIKE_GAIN = 3;
export const AFFECTION_ROUGH_LOSS = -4;

/** How much a touch zone is worth for affection (unlisted zones count 1). */
export const AFFECTION_ZONE_WEIGHT: Readonly<Partial<Record<string, number>>> = {
    ItemHead: 3,
    ItemEars: 2.4,
    ItemNose: 1.6,
    ItemMouth: 2,
    ItemNeck: 1.2,
    ItemBreast: 1.4,
    ItemNipples: 1.4,
    ItemHands: 1,
    ItemArms: 1,
    ItemTorso: 1,
    ItemPelvis: 1.2,
    ItemVulva: 2,
    ItemVulvaPiercings: 2.4,
    ItemButt: 1.4,
    ItemLegs: 0.9,
    ItemFeet: 0.8,
    ItemBoots: 0.8,
};

/** An orgasm costs this much water and sleep (when the option is on). */
export const ORGASM_WATER_COST = -5;
export const ORGASM_SLEEP_COST = -5;

// ------------------------------------------------------------------ Sex pet

export const SEX_PET_MODES: readonly string[] = ["Off", "Low", "Medium", "High"];
/** Food gained per oral act, by mode. */
export const SEX_PET_GAIN: Readonly<Record<string, number>> = { Off: 0, Low: 5, Medium: 10, High: 20 };
/** The partner finishing multiplies the mode gain into hydration. */
export const SEX_PET_THIRST_MULTIPLIER = 7;
/** Oral must have happened within this window before the partner's orgasm. */
export const SEX_PET_ORGASM_WINDOW_MS = 90_000;
export const SEX_PET_ORAL_ACTIVITIES: readonly string[] = [
    "Lick", "Kiss", "Nibble", "MasturbateTongue", "LSCG_Throat", "LSCG_Suck",
];
export const SEX_PET_REGIONS: readonly string[] = ["ItemVulva", "ItemVulvaPiercings", "ItemButt"];

// ------------------------------------------------------------------ Sleep

/** Emoticons that (with both eyes closed) count as sleeping. */
export const SLEEP_EMOTICONS: readonly string[] = ["Sleep", "Afk", "Fork", "Coding", "Read"];
/** ItemDevices assets that improve sleep recovery, by quality tier. */
export const BEDS_PERFECT: readonly string[] = ["PetBed", "Crib"];
export const BEDS_NORMAL: readonly string[] = ["LowCage", "Kennel", "Bed", "MedicalBed", "Cushion", "床左边_Luzi", "床右边_Luzi"];
export const BEDS_BASIC: readonly string[] = ["FuturisticCrate", "DollBox", "乳胶带床_Luzi"];

/** Sleep-recovery multiplier of the bed device a character lies in (1 = no bed). */
export function bedMultiplier(C: Character): number {
    const device = InventoryGet(C, "ItemDevices")?.Asset.Name ?? "";
    if (BEDS_PERFECT.includes(device)) {
        return 10;
    }
    if (BEDS_NORMAL.includes(device)) {
        return 5;
    }
    return BEDS_BASIC.includes(device) ? 2 : 1;
}

/** Whether the character looks asleep: both eyes closed plus a sleepy emoticon. */
export function isSleepingLook(C: Character): boolean {
    const expression = (group: string): string | undefined =>
        C.Appearance.find((a) => a.Asset.Group.Name === group)?.Property?.Expression ?? undefined;
    return expression("Eyes") === "Closed"
        && expression("Eyes2") === "Closed"
        && SLEEP_EMOTICONS.includes(expression("Emoticon") ?? "");
}

/**
 * Signed sleep rate factor: -1 drains normally, positive values RECOVER sleep
 * at that multiple of the drain speed. Sleeping look is worth x5, multiplied
 * by bed quality; lying in a bed awake recovers at bed quality alone.
 */
export function sleepFactor(C: Character): number {
    const bed = bedMultiplier(C);
    const sleeping = isSleepingLook(C);
    if (!sleeping && bed === 1) {
        return -1;
    }
    return bed * (sleeping ? 5 : 1);
}

// ------------------------------------------------------------------ Effects

/** Threshold choices for the scaling low-stat effects. */
export const TINT_THRESHOLD_CHOICES: readonly string[] = ["10%", "25%", "40%"];
export const HUNGER_THRESHOLD_CHOICES: readonly string[] = ["20%", "30%", "50%"];

/** Parses a stored "30%" option value. */
export function percentValue(raw: unknown, fallback: number): number {
    if (typeof raw !== "string") {
        return fallback;
    }
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : fallback;
}

/** A passed-out pet wakes once sleep has recovered to this level. */
export const PASSOUT_WAKE_LEVEL = 10;

/** What a passed-out pet's chat becomes (name is prefixed). */
export const PASSOUT_MUMBLES: readonly string[] = [
    "mumbles softly, fast asleep.",
    "shifts a little without waking.",
    "breathes slowly, deep asleep, a bit of drool escaping.",
];

/**
 * Skills affection influences and the correlation sign: a well-loved pet is
 * strong-willed and good at wearing its bonds, but too pet-brained for
 * rigging, escaping or lockpicking - a neglected pet the other way around.
 */
export const AFFECTION_SKILLS: readonly [string, 1 | -1][] = [
    ["SelfBondage", 1],
    ["Willpower", 1],
    ["Bondage", -1],
    ["Evasion", -1],
    ["LockPicking", -1],
];
/** Modifiers are re-asserted on this cadence (validity slightly longer). */
export const SKILL_MOD_INTERVAL_MS = 16_000;

/** Fully starved pets take this much longer to leave a room. */
export const SLOW_LEAVE_MAX_EXTRA_SEC = 25;

/**
 * Dry-throat speech: cracks words with pauses and stutters, harder with
 * severity (1 = occasional cracks, 3 = barely getting words out). Applied to
 * in-character segments only (the caller handles OOC).
 */
export function parchSpeech(text: string, severity: number): string {
    const chance = Math.min(0.9, 0.3 * severity);
    return text
        .split(/(\s+)/)
        .map((token) => {
            if (!/\p{L}/u.test(token) || Math.random() >= chance) {
                return token;
            }
            if (token.length < 3) {
                // Too short to crack - stutter it instead
                return `${token[0]}-${token}`;
            }
            const cut = Math.max(1, Math.floor(token.length / 2));
            const cracked = `${token.slice(0, cut)}...${token.slice(cut)}`;
            // Near-empty throats also stumble into the word
            return severity >= 3 && Math.random() < 0.5 ? `${token[0]}-${cracked}` : cracked;
        })
        .join("");
}

/** Rounds a level for the coarse public broadcast (nearest 5). */
export function coarseLevel(value: number): number {
    return Math.round(clampLevel(value) / 5) * 5;
}

/** Reads one attribute from an activity message's dictionary. */
export function chatDictAttr(data: ServerChatRoomMessage, key: string): unknown {
    const dictionary = data.Dictionary as unknown as Record<string, unknown>[] | undefined;
    if (!Array.isArray(dictionary)) {
        return undefined;
    }
    return dictionary.find((entry) => entry && typeof entry === "object" && entry[key] !== undefined)?.[key];
}
