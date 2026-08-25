/**
 * Pet vocabulary and speech transforms for the Pet rules: animal sound sets
 * for speaking, keyword sets a pet still understands while everything else
 * garbles, and the transforms that weave sounds into (or over) speech.
 * Transforms operate on in-character text only - callers segment OOC first.
 */

export const PET_ANIMALS = ["Bunny", "Cat", "Cow", "Dog", "Fox", "Mouse", "Pony", "Wolf", "Custom"] as const;

const ANIMAL_SOUNDS: Readonly<Record<string, readonly string[]>> = {
    Bunny: ["pyon", "eep", "snf-snf", "thump", "nngh"],
    Cat: ["meow", "mew", "nya", "purr", "mrrp", "mrow"],
    Cow: ["moo", "mooo", "muh", "hmmoo"],
    Dog: ["woof", "arf", "ruff", "bark", "wuff", "hff"],
    Fox: ["yip", "chirp", "yow", "ekek", "yip-yip"],
    Mouse: ["squeak", "eek", "pip", "skree"],
    Pony: ["neigh", "whinny", "snrt", "brrhh", "nnhh"],
    Wolf: ["awoo", "grrr", "ruff", "wuff", "aroo"],
};

/** Words any pet still understands through the garble. */
const HEARING_BASE: readonly string[] = [
    "good", "bad", "pet", "sit", "stay", "come", "down", "up", "paw", "speak", "quiet", "hush",
    "treat", "food", "water", "kibble", "eat", "drink", "bed", "sleep", "play", "toy",
    "walk", "walkies", "leash", "collar", "cage", "owner", "master", "mistress", "miss", "sir",
    "cutie", "adorable", "no", "yes", "heel", "all fours", "all-fours",
];

const ANIMAL_HEARING: Readonly<Record<string, readonly string[]>> = {
    Bunny: ["bun", "bunny", "carrot", "hop", "ears"],
    Cat: ["cat", "kitty", "kitten", "milk", "scratch", "knead", "yarn"],
    Cow: ["cow", "moo", "milk", "milking", "grass"],
    Dog: ["dog", "doggy", "pup", "puppy", "bone", "fetch", "kennel", "roll", "over", "bark"],
    Fox: ["fox", "foxy", "den", "yip"],
    Mouse: ["mouse", "mousie", "cheese", "nibble", "wheel"],
    Pony: ["pony", "mare", "stallion", "hoof", "hooves", "trot", "gallop", "hay", "bridle", "whoa", "easy", "stall"],
    Wolf: ["wolf", "pup", "puppy", "pack", "howl", "bone"],
};

/** The sounds a pet speaks: the chosen animal's set, or the custom list. */
export function petSounds(animal: string, custom: string[]): string[] {
    if (animal === "Custom") {
        return custom.map((s) => s.trim().toLocaleLowerCase()).filter((s) => s.length > 0);
    }
    return [...(ANIMAL_SOUNDS[animal] ?? ANIMAL_SOUNDS["Cat"]!)];
}

/** The words a pet understands: base + animal set + any custom extras. */
export function hearingWords(animal: string, custom: string[]): string[] {
    const extra = custom.map((s) => s.trim().toLocaleLowerCase()).filter((s) => s.length > 0);
    return [...HEARING_BASE, ...(ANIMAL_HEARING[animal] ?? []), ...extra];
}

/** Deals sounds from a shuffled double deck, so repeats spread out. */
class SoundBucket {
    private pile: string[] = [];
    constructor(private readonly sounds: string[]) {}
    next(): string {
        if (this.pile.length === 0) {
            this.pile = [...this.sounds, ...this.sounds];
            for (let i = this.pile.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [this.pile[i], this.pile[j]] = [this.pile[j]!, this.pile[i]!];
            }
        }
        return this.pile.pop() ?? "";
    }
}

export type PetSpeechIntensity = "Low" | "Medium" | "High" | "Max";

const SPRINKLE_CHANCE: Readonly<Record<PetSpeechIntensity, number>> = { Low: 0.05, Medium: 0.12, High: 0.22, Max: 0.35 };
const REPLACE_CHANCE: Readonly<Record<PetSpeechIntensity, number>> = { Low: 0.25, Medium: 0.5, High: 0.75, Max: 1 };

function capitalize(sound: string): string {
    return sound.charAt(0).toLocaleUpperCase() + sound.slice(1);
}

/** Appends one closing pet sound, respecting the sentence's punctuation. */
function appendSound(text: string, sound: string): string {
    if (/[.!?]$/.test(text)) {
        return `${text} ${capitalize(sound)}.`;
    }
    if (/\p{L}$/u.test(text)) {
        return `${text}, ${sound}.`;
    }
    return `${text} ${sound}.`;
}

/** Weaves pet sounds between the words; speech stays readable. */
export function sprinkleSpeech(text: string, sounds: string[], intensity: PetSpeechIntensity): string {
    if (sounds.length === 0 || text.trim().length === 0) {
        return text;
    }
    const bucket = new SoundBucket(sounds);
    const chance = SPRINKLE_CHANCE[intensity];
    let inserted = false;
    const result = text
        .split(/(\s+)/)
        .map((token) => {
            if (!/\p{L}/u.test(token) || Math.random() >= chance) {
                return token;
            }
            inserted = true;
            return `${bucket.next()}, ${token}`;
        })
        .join("");
    // Always end on a pet note at the higher intensities; sometimes otherwise
    if (!inserted && (intensity === "High" || intensity === "Max" || Math.random() < 0.25)) {
        return appendSound(result, bucket.next());
    }
    return result;
}

/** Swaps words for pet sounds; at Max the pet is fully non-verbal. */
export function replaceSpeech(text: string, sounds: string[], intensity: PetSpeechIntensity): string {
    if (sounds.length === 0) {
        return text;
    }
    const bucket = new SoundBucket(sounds);
    const chance = REPLACE_CHANCE[intensity];
    return text.replace(/\p{L}[\p{L}'-]*/gu, (word) => {
        if (Math.random() >= chance) {
            return word;
        }
        const sound = bucket.next();
        if (word.length > 1 && word === word.toLocaleUpperCase()) {
            return sound.toLocaleUpperCase();
        }
        return /^\p{Lu}/u.test(word) ? capitalize(sound) : sound;
    });
}

/**
 * Garbles text via `garble` while the known words pass through untouched.
 * Word-boundary, case-insensitive; ranges never split (longest-first merge).
 */
export function garbleKeepingWords(
    text: string,
    keepWords: string[],
    garble: (segment: string) => string,
): string {
    const lower = text.toLocaleLowerCase();
    const ranges: { start: number; end: number }[] = [];
    for (const word of keepWords) {
        if (word.length === 0) {
            continue;
        }
        const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        for (const match of lower.matchAll(new RegExp(`(?<=^|\\W)${escaped}(?=$|\\W)`, "g"))) {
            ranges.push({ start: match.index, end: match.index + word.length });
        }
    }
    if (ranges.length === 0) {
        return garble(text);
    }
    ranges.sort((a, b) => a.start - b.start || b.end - a.end);
    // Merge overlaps so a word inside a longer kept phrase is not split
    const merged: { start: number; end: number }[] = [];
    for (const range of ranges) {
        const last = merged[merged.length - 1];
        if (last && range.start <= last.end) {
            last.end = Math.max(last.end, range.end);
        } else {
            merged.push({ ...range });
        }
    }
    let position = 0;
    let result = "";
    for (const range of merged) {
        if (range.start > position) {
            result += garble(text.slice(position, range.start));
        }
        result += text.slice(range.start, range.end);
        position = range.end;
    }
    if (position < text.length) {
        result += garble(text.slice(position));
    }
    return result;
}
