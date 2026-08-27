import { RuleDefinition } from "@/system/rules/RuleTypes";
import { stringListValue } from "@/system/gui/Settings";
import { isRuleSend, spokenText } from "@/rules/speechUtils";

function findForbiddenWord(content: string, words: string[]): string | null {
    const lower = content.toLocaleLowerCase();
    for (const word of words) {
        const pattern = new RegExp(`(^|\\W)${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\W)`);
        if (pattern.test(lower)) {
            return word;
        }
    }
    return null;
}

/** Blocks chat and whisper messages containing configured forbidden words. */
export const ForbiddenWords: RuleDefinition = {
    id: "speech.forbiddenWords",
    name: "Forbidden words",
    description: "The player cannot use the configured words in chat or whispers.",
    category: "Speech",
    bcxEquivalent: "speech_ban_words",
    announceAttempt: "{Name} tried to say a forbidden word.",
    announceViolation: "{Name} said a forbidden word.",
    settings: [{
        type: "stringList",
        name: "words",
        label: "Forbidden words:",
        default: [],
        entryLabel: "word",
        maxChars: 100,
    }, {
        type: "checkbox",
        name: "includeOOC",
        label: "Also forbid the words in OOC (parentheses)",
        default: false,
    }],
    load(ctx) {
        ctx.hook("ServerSend", 5, (args, next) => {
            if (isRuleSend()) {
                return next(args);
            }
            const [event, data] = args as unknown as [string, { Type?: string; Content?: string }];
            if (event !== "ChatRoomChat" || (data?.Type !== "Chat" && data?.Type !== "Whisper") || typeof data.Content !== "string") {
                return next(args);
            }
            const words = stringListValue(ctx.setting<unknown>("words")).map((w) => w.toLocaleLowerCase());
            if (words.length === 0) {
                return next(args);
            }
            // OOC segments are exempt unless configured otherwise
            const checked = ctx.setting<boolean>("includeOOC") === true
                ? data.Content
                : spokenText(data.Content);
            const match = findForbiddenWord(checked, words);
            if (match === null) {
                return next(args);
            }
            if (ctx.isEnforced()) {
                ctx.triggerAttempt();
                ctx.notify(`A rule forbids you from saying "${match}".`);
                return;
            }
            ctx.trigger();
            return next(args);
        });
    },
};
