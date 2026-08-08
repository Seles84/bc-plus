import { RuleDefinition } from "@/system/rules/RuleTypes";
import { lettersOfWords, spokenPayload, spokenText } from "@/rules/speechUtils";

/** Restricts speech to short, simple doll-like phrases. OOC text is exempt. */
export const DollTalk: RuleDefinition = {
    id: "speech.dollTalk",
    name: "Doll talk",
    description: "The player can only speak in short, simple phrases: limited words per message "
        + "and letters per word. Out-of-character text is not affected.",
    category: "Speech",
    announceAttempt: "{Name} tried to say something too complex for a doll.",
    settings: [
        {
            type: "option",
            name: "maxWords",
            label: "Maximum words per message",
            options: ["3", "5", "7", "10"],
            default: "5",
        },
        {
            type: "option",
            name: "maxWordLength",
            label: "Maximum letters per word",
            options: ["4", "5", "6", "7", "8"],
            default: "6",
        },
    ],
    load(ctx) {
        ctx.hook("ServerSend", 5, (args, next) => {
            const data = spokenPayload(args as unknown[]);
            if (!data) {
                return next(args);
            }
            const words = lettersOfWords(spokenText(data.Content));
            const maxWords = Number.parseInt(ctx.setting<string>("maxWords"), 10);
            const maxLength = Number.parseInt(ctx.setting<string>("maxWordLength"), 10);
            if (words.length <= maxWords && words.every((w) => w.length <= maxLength)) {
                return next(args);
            }
            if (ctx.isEnforced()) {
                ctx.triggerAttempt();
                ctx.notify(`Dolls speak simply: at most ${maxWords} words of ${maxLength} letters.`);
                return;
            }
            ctx.trigger();
            return next(args);
        });
    },
};
