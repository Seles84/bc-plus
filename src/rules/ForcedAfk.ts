import { RuleDefinition } from "@/system/rules/RuleTypes";

const AFK_CHECK_MS = 5000;
/** Same activity events BC's own AfkTimer watches, plus keydown for non-printing keys. */
const AFK_EVENTS = ["mousedown", "mousemove", "keypress", "keydown", "touchstart"] as const;
const REPLY_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Applies configured behaviors while the player is idle. Compatible with BC's
 * built-in AFK timer: both listen for the same events, and because this rule's
 * listener registers later it restores last - the player's original emoticon
 * always wins on wake.
 */
export const ForcedAfkBehavior: RuleDefinition = {
    id: "body.afkBehavior",
    name: "Forced AFK behavior",
    description: "When the player goes idle, the configured behaviors apply automatically: "
        + "the Afk emoticon, closed eyes, kneeling, and an automatic reply to whispers. "
        + "Emoticon and eyes are restored the moment the player is back; a forced kneel "
        + "is left for them to stand up from.",
    category: "Body",
    settings: [
        {
            type: "option",
            name: "idleMinutes",
            label: "Minutes until idle",
            options: ["2", "5", "10", "15", "30"],
            default: "5",
        },
        {
            type: "checkbox",
            name: "afkEmoticon",
            label: "Show the Afk emoticon",
            default: true,
        },
        {
            type: "checkbox",
            name: "closeEyes",
            label: "Close the eyes",
            default: false,
        },
        {
            type: "checkbox",
            name: "kneel",
            label: "Kneel down",
            default: false,
        },
        {
            type: "checkbox",
            name: "autoReply",
            label: "Auto-reply to whispers",
            default: false,
        },
        {
            type: "text",
            name: "replyText",
            label: "Auto-reply text:",
            default: "I am away from the club right now.",
            maxChars: 150,
        },
    ],
    load(ctx) {
        let lastActivity = Date.now();
        let idle = false;
        // What sleep() actually changed, so wake() undoes exactly that even
        // if the settings were edited mid-idle
        let appliedEmoticon = false;
        let appliedEyes = false;
        let savedEmoticon: ExpressionName | undefined;
        let savedEyes: ExpressionName | undefined;
        const lastReply = new Map<number, number>();

        const wake = (): void => {
            if (!idle) {
                return;
            }
            idle = false;
            if (appliedEmoticon) {
                CharacterSetFacialExpression(Player, "Emoticon", savedEmoticon);
            }
            if (appliedEyes) {
                CharacterSetFacialExpression(Player, "Eyes", savedEyes);
            }
            appliedEmoticon = false;
            appliedEyes = false;
            savedEmoticon = undefined;
            savedEyes = undefined;
            lastReply.clear();
        };

        const sleep = (): void => {
            idle = true;
            const expression = WardrobeGetExpression(Player);
            if (ctx.setting<boolean>("afkEmoticon")) {
                savedEmoticon = expression.Emoticon;
                appliedEmoticon = true;
            }
            if (ctx.setting<boolean>("closeEyes")) {
                savedEyes = expression.Eyes;
                appliedEyes = true;
            }
        };

        // Re-applied every tick while idle, so other effects (or BC's own
        // AFK timer) never permanently unset the rule's behaviors
        const assertIdleState = (): void => {
            const expression = WardrobeGetExpression(Player);
            if (appliedEmoticon && expression.Emoticon !== "Afk") {
                CharacterSetFacialExpression(Player, "Emoticon", "Afk");
            }
            if (appliedEyes && expression.Eyes !== "Closed") {
                CharacterSetFacialExpression(Player, "Eyes", "Closed");
            }
            // Like ForceKneeling: only correct what the player could correct
            // themselves - never fight restraints
            if (ctx.setting<boolean>("kneel") && !Player.IsKneeling()
                && PoseCanChangeUnaided(Player, "Kneel")) {
                PoseSetActive(Player, "Kneel", true);
                if (ServerPlayerIsInChatRoom()) {
                    ChatRoomCharacterUpdate(Player);
                }
            }
        };

        const onActivity = (): void => {
            lastActivity = Date.now();
            wake();
        };
        for (const event of AFK_EVENTS) {
            document.addEventListener(event, onActivity, true);
        }
        ctx.cleanup(() => {
            for (const event of AFK_EVENTS) {
                document.removeEventListener(event, onActivity, true);
            }
            wake();
        });

        ctx.interval(() => {
            if (typeof Player === "undefined" || !Player.MemberNumber || !ServerIsConnected) {
                return;
            }
            if (!ctx.isEnforced()) {
                wake();
                return;
            }
            const idleAfterMs = parseInt(ctx.setting<string>("idleMinutes"), 10) * 60 * 1000;
            if (!idle && Date.now() - lastActivity >= idleAfterMs) {
                sleep();
            }
            if (idle) {
                assertIdleState();
            }
        }, AFK_CHECK_MS);

        ctx.hook("ChatRoomMessage", 6, (args, next) => {
            const data = args[0] as Partial<ServerChatRoomMessage> | undefined;
            if (idle && ctx.isEnforced() && ctx.setting<boolean>("autoReply")
                && data?.Type === "Whisper"
                && typeof data.Sender === "number"
                && data.Sender !== Player.MemberNumber
                && ServerPlayerIsInChatRoom()) {
                const now = Date.now();
                if (now - (lastReply.get(data.Sender) ?? 0) >= REPLY_COOLDOWN_MS) {
                    lastReply.set(data.Sender, now);
                    // OOC-wrapped so speech rules and garbling leave it alone,
                    // and the leading parenthesis rules out command injection
                    const text = ctx.setting<string>("replyText")
                        .replace(/[\r\n()]/g, " ").trim().slice(0, 150);
                    ServerSend("ChatRoomChat", {
                        Content: `(AFK auto-reply: ${text.length > 0 ? text : "I am away right now."})`,
                        Type: "Whisper",
                        Target: data.Sender,
                    });
                }
            }
            return next(args);
        });
    },
};
