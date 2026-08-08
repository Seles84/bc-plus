import { RuleDefinition } from "@/system/rules/RuleTypes";
import { parseWordList, spokenPayload, spokenText } from "@/rules/speechUtils";

function normalize(text: string): string {
    return text.toLocaleLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
}

/** The player may only say phrases from a configured list. */
export const RestrainedSpeech: RuleDefinition = {
    id: "speech.restrainedSpeech",
    name: "Restrained speech",
    description: "The player can only say the configured phrases, nothing else "
        + "(comma-separated; case and end punctuation are ignored). "
        + "Purely out-of-character messages are exempt.",
    category: "Speech",
    announceAttempt: "{Name} tried to say something they are not allowed to.",
    settings: [{
        type: "text",
        name: "phrases",
        label: "Allowed phrases:",
        default: "Yes Miss, No Miss, Thank you Miss, Please Miss",
        maxChars: 500,
    }],
    load(ctx) {
        ctx.hook("ServerSend", 5, (args, next) => {
            const data = spokenPayload(args as unknown[]);
            if (!data) {
                return next(args);
            }
            const phrases = parseWordList(ctx.setting<string>("phrases")).map(normalize);
            const spoken = normalize(spokenText(data.Content));
            if (phrases.length === 0 || spoken.length === 0 || phrases.includes(spoken)) {
                return next(args);
            }
            if (ctx.isEnforced()) {
                ctx.triggerAttempt();
                ctx.notify("A rule restrains your speech to the allowed phrases.");
                return;
            }
            ctx.trigger();
            return next(args);
        });
    },
};
