import { RuleDefinition } from "@/system/rules/RuleTypes";

/**
 * Blocks sending beep messages from the friend list. Plain beeps
 * (without a message) can be allowed via the rule's setting.
 */
export const ForbidBeepMessages: RuleDefinition = {
    id: "social.forbidBeepMessages",
    name: "Forbid beep messages",
    description: "The player cannot send beeps with message content to friends.",
    category: "Social",
    announceAttempt: "{Name} tried to send a beep message, which a rule forbids.",
    announceViolation: "{Name} sent a beep message, which a rule forbids.",
    settings: [{
        type: "checkbox",
        name: "allowPlainBeeps",
        label: "Still allow plain beeps without a message",
        default: true,
    }],
    load(ctx) {
        ctx.hook("ServerSendBeepMessage", 5, (args, next) => {
            const [target, msg] = args;
            const isPlain = msg === undefined || msg === "";
            if (isPlain && ctx.setting<boolean>("allowPlainBeeps")) {
                return next(args);
            }
            if (ctx.isEnforced()) {
                ctx.triggerAttempt(typeof target === "number" ? target : null);
                ctx.notify("A rule forbids you from sending beep messages.");
                return;
            }
            ctx.trigger(typeof target === "number" ? target : null);
            return next(args);
        });
    },
};
