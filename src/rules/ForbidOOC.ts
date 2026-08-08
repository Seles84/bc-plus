import { RuleDefinition } from "@/system/rules/RuleTypes";

/** Blocks chat messages containing out-of-character segments (parentheses). */
export const ForbidOOC: RuleDefinition = {
    id: "speech.forbidOOC",
    name: "Forbid OOC messages",
    description: "The player cannot send messages containing out-of-character (parenthesized) text. "
        + "Whispers are not affected.",
    category: "Speech",
    announceAttempt: "{Name} tried to use OOC in a message, which a rule forbids.",
    announceViolation: "{Name} used OOC in a message, which a rule forbids.",
    load(ctx) {
        ctx.hook("ServerSend", 5, (args, next) => {
            const [event, data] = args as unknown as [string, { Type?: string; Content?: string }];
            if (event !== "ChatRoomChat" || data?.Type !== "Chat" || typeof data.Content !== "string") {
                return next(args);
            }
            if (SpeechGetOOCRanges(data.Content).length === 0) {
                return next(args);
            }
            if (ctx.isEnforced()) {
                ctx.triggerAttempt();
                ctx.notify("A rule forbids you from speaking out of character.");
                return;
            }
            ctx.trigger();
            return next(args);
        });
    },
};
