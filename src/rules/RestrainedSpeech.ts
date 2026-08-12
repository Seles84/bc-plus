import { RuleDefinition } from "@/system/rules/RuleTypes";
import { stringListValue } from "@/system/gui/Settings";
import { spokenPayload, spokenText } from "@/rules/speechUtils";

function normalize(text: string): string {
    return text.toLocaleLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
}

/** The player may only say phrases from a configured list. */
export const RestrainedSpeech: RuleDefinition = {
    id: "speech.restrainedSpeech",
    name: "Restrained speech",
    description: "The player can only say the configured phrases, nothing else "
        + "(case and end punctuation are ignored). "
        + "Purely out-of-character messages are exempt.",
    category: "Speech",
    bcxEquivalent: "speech_restrained_speech",
    announceAttempt: "{Name} tried to say something they are not allowed to.",
    settings: [{
        type: "stringList",
        name: "phrases",
        label: "Allowed phrases:",
        default: ["Yes Miss", "No Miss", "Thank you Miss", "Please Miss"],
        entryLabel: "phrase",
        maxChars: 120,
    }],
    load(ctx) {
        ctx.hook("ServerSend", 5, (args, next) => {
            const data = spokenPayload(args as unknown[]);
            if (!data) {
                return next(args);
            }
            const phrases = stringListValue(ctx.setting<unknown>("phrases")).map(normalize);
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
