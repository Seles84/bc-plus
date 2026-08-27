import { RuleDefinition } from "@/system/rules/RuleTypes";
import { sendAsRule } from "@/rules/speechUtils";

/** Automatically says the configured farewell when leaving a room. */
export const FarewellOnLeave: RuleDefinition = {
    id: "social.farewell",
    name: "Farewell on leave",
    description: "When leaving a chat room, the player automatically says the configured farewell first.",
    category: "Social",
    bcxEquivalent: "farewell_on_slow_leave",
    settings: [{
        type: "text",
        name: "farewell",
        label: "Farewell:",
        default: "Goodbye everyone!",
        maxChars: 200,
    }],
    load(ctx) {
        ctx.hook("ChatRoomAttemptLeave", 4, (args, next) => {
            const farewell = ctx.setting<string>("farewell").trim();
            if (ctx.isEnforced() && farewell.length > 0 && ServerPlayerIsInChatRoom()) {
                sendAsRule(() => ServerSend("ChatRoomChat", { Content: farewell, Type: "Chat" }));
            }
            return next(args);
        });
    },
};
