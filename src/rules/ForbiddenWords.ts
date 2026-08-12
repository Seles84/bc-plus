import { RuleDefinition } from "@/system/rules/RuleTypes";

function parseWordList(raw: string): string[] {
    return raw
        .split(",")
        .map((w) => w.trim().toLocaleLowerCase())
        .filter((w) => w.length > 0);
}

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
    description: "The player cannot use the configured words in chat or whispers. "
        + "Separate words with commas.",
    category: "Speech",
    bcxEquivalent: "speech_ban_words",
    announceAttempt: "{Name} tried to say a forbidden word.",
    announceViolation: "{Name} said a forbidden word.",
    settings: [{
        type: "text",
        name: "words",
        label: "Forbidden words:",
        default: "",
        maxChars: 500,
    }],
    load(ctx) {
        ctx.hook("ServerSend", 5, (args, next) => {
            const [event, data] = args as unknown as [string, { Type?: string; Content?: string }];
            if (event !== "ChatRoomChat" || (data?.Type !== "Chat" && data?.Type !== "Whisper") || typeof data.Content !== "string") {
                return next(args);
            }
            const words = parseWordList(ctx.setting<string>("words"));
            if (words.length === 0) {
                return next(args);
            }
            const match = findForbiddenWord(data.Content, words);
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
