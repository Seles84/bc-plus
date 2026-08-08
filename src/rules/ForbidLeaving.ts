import { RuleDefinition } from "@/system/rules/RuleTypes";

/** Prevents the player from leaving the current chat room. */
export const ForbidLeaving: RuleDefinition = {
    id: "chat.forbidLeaving",
    name: "Forbid leaving the room",
    description: "The player cannot leave the chat room they are in. "
        + "Disconnects and relogs are not prevented.",
    category: "Other",
    load(ctx) {
        ctx.hook("ChatRoomAttemptLeave", 5, (args, next) => {
            if (ctx.isEnforced()) {
                ctx.triggerAttempt();
                ctx.notify("A rule forbids you from leaving the room.");
                return;
            }
            ctx.trigger();
            return next(args);
        });
    },
};
