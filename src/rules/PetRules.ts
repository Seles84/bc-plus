import { RuleDefinition } from "@/system/rules/RuleTypes";
import { stringListValue } from "@/system/gui/Settings";
import { spokenPayload, transformSpoken } from "@/rules/speechUtils";
import {
    PET_ANIMALS, PetSpeechIntensity, garbleKeepingWords, hearingWords, petSounds,
    replaceSpeech, sprinkleSpeech,
} from "@/system/pet/PetLanguage";

/**
 * Heard-garble intensity the hearing rule forces (BC's deafen scale:
 * 4 = light deafness, 12 = heavy).
 */
const HEARING_FORCE: Readonly<Record<string, number>> = {
    "Only when deafened": 0,
    "Light": 4,
    "Heavy": 12,
};

/** Pronoun-dependent words that always reach the pet, like their name. */
function selfWords(): string[] {
    const words = [(Player.Nickname || Player.Name).toLocaleLowerCase()];
    try {
        if (Player.GetPronouns() === "SheHer") {
            words.push("girl", "she", "her");
        } else {
            words.push("boy", "he", "him");
        }
    } catch {
        // Pronouns unavailable - the name alone still passes
    }
    return words;
}

/** Speech laced with (or replaced by) pet sounds. OOC text is exempt. */
export const PetSpeech: RuleDefinition = {
    id: "pet.speech",
    name: "Speak like a pet",
    description: "The player's speech turns pet-like: Sprinkle mode weaves animal sounds "
        + "between the words, Replace mode swaps words for sounds outright - up to fully "
        + "non-verbal at Max intensity. Pick an animal sound set or provide custom sounds. "
        + "Out-of-character text is never touched.",
    category: "Pet",
    settings: [
        {
            type: "option",
            name: "animal",
            label: "Sound set",
            options: [...PET_ANIMALS],
            default: "Cat",
        },
        {
            type: "stringList",
            name: "sounds",
            label: "Custom sounds (used with the Custom set):",
            default: [],
            maxChars: 24,
            maxEntries: 20,
            entryLabel: "sound",
        },
        {
            type: "option",
            name: "mode",
            label: "Mode",
            options: ["Sprinkle", "Replace"],
            default: "Sprinkle",
        },
        {
            type: "option",
            name: "intensity",
            label: "Intensity",
            options: ["Low", "Medium", "High", "Max"],
            default: "Medium",
        },
    ],
    load(ctx) {
        ctx.hook("ServerSend", 4, (args, next) => {
            const data = spokenPayload(args as unknown[]);
            if (!data || !ctx.isEnforced()) {
                return next(args);
            }
            const sounds = petSounds(ctx.setting<string>("animal"), stringListValue(ctx.setting<unknown>("sounds")));
            if (sounds.length === 0) {
                return next(args);
            }
            const mode = ctx.setting<string>("mode");
            const intensity = (ctx.setting<string>("intensity") || "Medium") as PetSpeechIntensity;
            data.Content = transformSpoken(data.Content, (text) =>
                (mode === "Replace" ? replaceSpeech(text, sounds, intensity) : sprinkleSpeech(text, sounds, intensity)));
            return next(args);
        });
    },
};

/** The pet only understands pet words; the rest garbles away. */
export const PetHearing: RuleDefinition = {
    id: "pet.hearing",
    name: "Hear like a pet",
    description: "Pet words - commands, praise, the pet's own name, the chosen animal's "
        + "vocabulary and any custom extras - always come through clearly, while the rest "
        + "of what the player hears garbles away. \"Only when deafened\" merely lets the "
        + "pet words pierce existing deafness (item- or hunger-induced); Light and Heavy "
        + "garble everything else all the time. Out-of-character text is never touched.",
    category: "Pet",
    settings: [
        {
            type: "option",
            name: "animal",
            label: "Vocabulary set",
            options: [...PET_ANIMALS],
            default: "Cat",
        },
        {
            type: "stringList",
            name: "words",
            label: "Extra understood words:",
            default: [],
            maxChars: 32,
            maxEntries: 30,
            entryLabel: "word",
        },
        {
            type: "option",
            name: "strength",
            label: "Everything else garbles",
            options: Object.keys(HEARING_FORCE),
            default: "Light",
        },
    ],
    load(ctx) {
        // Raise the heard-garble intensity floor; BC then routes every heard
        // message through the garble below (it skips the call at intensity 0)
        ctx.hook("SpeechTransformDeafenIntensity", 3, (args, next) => {
            const intensity = next(args);
            if (!ctx.isEnforced()) {
                return intensity;
            }
            const forced = HEARING_FORCE[ctx.setting<string>("strength")] ?? 0;
            return Math.max(intensity, forced);
        });

        // Keep the pet's words clear through any garble (gag- or deaf-side)
        ctx.hook("SpeechTransformGagGarble", 3, (args, next) => {
            if (!ctx.isEnforced()) {
                return next(args);
            }
            const [text, intensity, ignoreOOC] = args as unknown as [string, number, boolean | undefined];
            if (typeof text !== "string" || text.length === 0
                || typeof intensity !== "number" || Number.isNaN(intensity) || intensity <= 0) {
                return next(args);
            }
            const words = [
                ...hearingWords(ctx.setting<string>("animal"), stringListValue(ctx.setting<unknown>("words"))),
                ...selfWords(),
            ];
            return garbleKeepingWords(text, words, (segment) => next([segment, intensity, ignoreOOC] as never));
        });
    },
};
