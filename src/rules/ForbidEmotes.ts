import { RuleDefinition } from "@/system/rules/RuleTypes";

/** Blocks sending emote messages (* and /me). */
export const ForbidEmotes: RuleDefinition = {
    id: "speech.forbidEmotes",
    name: "Forbid emotes",
    description: "The player cannot send emote messages to the room.",
    category: "Speech",
    bcxEquivalent: "speech_forbid_emotes",
    announceAttempt: "{Name} tried to emote, which a rule forbids.",
    announceViolation: "{Name} emoted, which a rule forbids.",
    load(ctx) {
        ctx.hook("ServerSend", 5, (args, next) => {
            const [event, data] = args as unknown as [string, { Type?: string }];
            if (event !== "ChatRoomChat" || data?.Type !== "Emote") {
                return next(args);
            }
            if (ctx.isEnforced()) {
                ctx.triggerAttempt();
                ctx.notify("A rule forbids you from sending emotes.");
                return;
            }
            ctx.trigger();
            return next(args);
        });
    },
};
