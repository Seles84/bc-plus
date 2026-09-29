import { RuleDefinition } from "@/system/rules/RuleTypes";
import { spokenPayload, spokenText } from "@/rules/speechUtils";

/** Spoken chat messages must contain at least the configured number of words. */
export const MinimumWords: RuleDefinition = {
    id: "speech.minimumWords",
    name: "Require detailed speech",
    description: "Every chat message must contain at least the configured number of words - "
        + "doll talk in reverse, for detailed roleplay. Purely out-of-character messages and "
        + "emotes are exempt.",
    category: "Speech",
    announceAttempt: "{Name} was told to speak in more detail.",
    settings: [
        {
            type: "option",
            name: "minWords",
            label: "Minimum words per message:",
            options: ["2", "3", "4", "5", "6", "8", "10", "15", "20"],
            default: "5",
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
            const minimum = Number.parseInt(ctx.setting<string>("minWords") ?? "5", 10) || 5;
            const spoken = spokenText(data.Content);
            if (spoken.length === 0) {
                return next(args);
            }
            // Only tokens carrying a letter or digit count as words - "..."
            // or "?!" alone should not satisfy a detail requirement
            const words = spoken.split(/\s+/u).filter((token) => /[\p{L}\p{N}]/u.test(token));
            if (words.length >= minimum) {
                return next(args);
            }
            if (ctx.isEnforced()) {
                ctx.triggerAttempt();
                ctx.notify(`A rule requires at least ${minimum} words per message (this had ${words.length}).`);
                return;
            }
            ctx.trigger();
            return next(args);
        });
    },
};
