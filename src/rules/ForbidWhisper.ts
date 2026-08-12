import { RuleDefinition } from "@/system/rules/RuleTypes";
import { Role } from "@/system/Roles";

/**
 * Blocks outgoing whispers at the ServerSend level, which also catches
 * whispers sent via the /w chat command.
 */
export const ForbidWhisper: RuleDefinition = {
    id: "speech.forbidWhisper",
    name: "Forbid whispering",
    description: "The player cannot send whispers to other people in the room.",
    category: "Speech",
    bcxEquivalent: "speech_restrict_whisper_send",
    announceAttempt: "{Name} tried to whisper, which a rule forbids.",
    announceViolation: "{Name} whispered, which a rule forbids.",
    settings: [{
        type: "checkbox",
        name: "allowLover",
        label: "Still allow whispering to Lover-ranked roles and above",
        default: true,
    }],
    load(ctx) {
        ctx.hook("ServerSend", 5, (args, next) => {
            const [event, data] = args as unknown as [string, { Type?: string; Target?: number }];
            if (event !== "ChatRoomChat" || data?.Type !== "Whisper") {
                return next(args);
            }
            const target = typeof data.Target === "number" ? data.Target : null;
            if (ctx.setting<boolean>("allowLover") && target !== null && ctx.highestRoleOf(target) <= Role.Lover) {
                return next(args);
            }
            if (ctx.isEnforced()) {
                ctx.triggerAttempt(target);
                ctx.notify("A rule forbids you from whispering.");
                return;
            }
            ctx.trigger(target);
            return next(args);
        });
    },
};
