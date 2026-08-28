import { RuleDefinition } from "@/system/rules/RuleTypes";
import { sendAsRule } from "@/rules/speechUtils";

/** Automatically says the configured greeting when entering a room. */
export const GreetRoom: RuleDefinition = {
    id: "social.greetRoom",
    name: "Order to greet the room",
    description: "On entering a chat room, the player automatically says the configured greeting.",
    category: "Social",
    bcxEquivalent: "greet_room_order",
    settings: [{
        type: "text",
        name: "greeting",
        label: "Greeting:",
        default: "Hello everyone!",
        maxChars: 200,
    }],
    load(ctx) {
        ctx.hook("ChatRoomSync", 0, (args, next) => {
            const result = next(args);
            void Promise.resolve(result as unknown).then(() => {
                // Tracked: never fires after the rule was switched off
                ctx.timeout(() => {
                    const greeting = ctx.setting<string>("greeting").trim();
                    if (ctx.isEnforced() && greeting.length > 0) {
                        sendAsRule(() => ServerSend("ChatRoomChat", { Content: greeting, Type: "Chat" }));
                    }
                }, 1500);
            });
            return result;
        });
    },
};
