import { RuleDefinition } from "@/system/rules/RuleTypes";

function isShouting(content: string): boolean {
    const letters = content.replace(/[^\p{L}]/gu, "");
    return letters.length >= 4 && content === content.toLocaleUpperCase() && content !== content.toLocaleLowerCase();
}

/**
 * Stops the player from shouting: all-caps chat messages are converted
 * to lowercase when enforced (the message still goes through).
 */
export const ForbidShouting: RuleDefinition = {
    id: "speech.forbidShouting",
    name: "Forbid shouting",
    description: "All-caps chat messages are lowered to normal speech when enforced.",
    category: "Speech",
    announceAttempt: "{Name} tried to shout, but a rule quieted them.",
    announceViolation: "{Name} shouted, which a rule frowns upon.",
    load(ctx) {
        ctx.hook("ServerSend", 5, (args, next) => {
            const [event, data] = args as unknown as [string, { Type?: string; Content?: string }];
            if (event !== "ChatRoomChat" || (data?.Type !== "Chat" && data?.Type !== "Whisper") || typeof data.Content !== "string") {
                return next(args);
            }
            if (!isShouting(data.Content)) {
                return next(args);
            }
            if (ctx.isEnforced()) {
                data.Content = data.Content.toLocaleLowerCase();
                ctx.triggerAttempt();
                ctx.notify("A rule keeps you from shouting - your message was quieted.");
            } else {
                ctx.trigger();
            }
            return next(args);
        });
    },
};
