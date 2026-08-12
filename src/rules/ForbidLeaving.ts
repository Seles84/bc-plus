import { RuleDefinition } from "@/system/rules/RuleTypes";

/** Prevents the player from leaving the current chat room. */
export const ForbidLeaving: RuleDefinition = {
    id: "chat.forbidLeaving",
    name: "Forbid leaving the room",
    description: "The player cannot leave the chat room they are in - the exit button and "
        + "leave commands from other mods are both blocked. Forced moves (leashes, kicks, "
        + "BC's safeword release) and disconnects are not prevented.",
    category: "Other",
    bcxEquivalent: "block_leaving_room",
    announceAttempt: "{Name} tried to leave the room, which a rule forbids.",
    announceViolation: "{Name} left despite a rule forbidding it.",
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
        // BC's official may-the-player-leave gate: disables the exit button,
        // interrupts slow-leaving and stops mod-added leave commands. Forced
        // moves (leash, kick, cell, safeword release) never consult it, so
        // they keep working - do NOT hook ChatRoomLeave itself for that reason
        ctx.hook("ChatRoomCanLeave", 6, (args, next) => {
            if (ctx.isEnforced()) {
                return false;
            }
            return next(args);
        });
    },
};
