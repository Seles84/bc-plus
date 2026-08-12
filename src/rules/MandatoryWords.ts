import { RuleDefinition } from "@/system/rules/RuleTypes";
import { containsWord, parseWordList, spokenPayload, spokenText } from "@/rules/speechUtils";

/** Every spoken chat message must contain one of the configured words. */
export const MandatoryWords: RuleDefinition = {
    id: "speech.mandatoryWords",
    name: "Mandatory words",
    description: "Every chat message must contain at least one of the configured words "
        + "(e.g. \"Miss, please, humbly\"). Purely out-of-character messages are exempt.",
    category: "Speech",
    bcxEquivalent: "speech_mandatory_words",
    announceAttempt: "{Name} forgot to speak properly.",
    settings: [
        {
            type: "text",
            name: "words",
            label: "Required words:",
            default: "",
            maxChars: 300,
        },
        {
            type: "checkbox",
            name: "includeWhispers",
            label: "Also apply to whispers",
            default: false,
        },
    ],
    load(ctx) {
        ctx.hook("ServerSend", 5, (args, next) => {
            const types = ctx.setting<boolean>("includeWhispers") ? ["Chat", "Whisper"] : ["Chat"];
            const data = spokenPayload(args as unknown[], types);
            if (!data) {
                return next(args);
            }
            const words = parseWordList(ctx.setting<string>("words"));
            const spoken = spokenText(data.Content);
            if (words.length === 0 || spoken.length === 0 || words.some((w) => containsWord(spoken, w))) {
                return next(args);
            }
            if (ctx.isEnforced()) {
                ctx.triggerAttempt();
                ctx.notify(`A rule requires you to include one of: ${words.join(", ")}.`);
                return;
            }
            ctx.trigger();
            return next(args);
        });
    },
};
