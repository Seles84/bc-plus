import { RuleDefinition } from "@/system/rules/RuleTypes";
import { spokenPayload, transformSpoken } from "@/rules/speechUtils";

function stutterWord(word: string): string {
    const first = word[0];
    if (!first || !/\p{L}/u.test(first)) {
        return word;
    }
    const roll = Math.random();
    if (roll < 0.12) {
        return `${first}-${first}-${word}`;
    }
    return `${first}-${word}`;
}

function stutter(text: string): string {
    return text
        .split(/(\s+)/)
        .map((part) => (/\S/.test(part) && Math.random() < 0.45 ? stutterWord(part) : part))
        .join("");
}

/** Makes the player stutter when enforced. OOC text is exempt. */
export const FalteringSpeech: RuleDefinition = {
    id: "speech.faltering",
    name: "Enforce faltering speech",
    description: "The player's spoken messages come out st-st-stuttering. "
        + "Out-of-character text is not affected.",
    category: "Speech",
    bcxEquivalent: "speech_alter_faltering",
    load(ctx) {
        ctx.hook("ServerSend", 4, (args, next) => {
            const data = spokenPayload(args as unknown[]);
            if (!data || !ctx.isEnforced()) {
                return next(args);
            }
            data.Content = transformSpoken(data.Content, stutter);
            return next(args);
        });
    },
};
