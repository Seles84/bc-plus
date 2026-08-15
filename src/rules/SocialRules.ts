import { RuleDefinition } from "@/system/rules/RuleTypes";
import { membersValue } from "@/system/gui/Settings";

/**
 * Social rules batch 2: full beep blocking and friend-list protection.
 * Hidden protocol beeps (leash pulls, BCX comms, summons) always carry a
 * BeepType, while user beeps are sent with an empty one - that is the line
 * between "the player beeping someone" and "mods talking to each other".
 */

export const ForbidBeeps: RuleDefinition = {
    id: "social.forbidBeeps",
    name: "Forbid sending beeps",
    description: "The player cannot send any beeps at all, with or without a message. "
        + "Hidden mod-to-mod beeps (leashes, summons, BCX) are unaffected, and "
        + "configured members can still be beeped.",
    category: "Social",
    announceAttempt: "{Name} tried to send a beep, which a rule forbids.",
    announceViolation: "{Name} sent a beep, which a rule forbids.",
    settings: [{
        type: "members",
        name: "allowedMembers",
        label: "Members who may still be beeped:",
        default: [],
    }],
    load(ctx) {
        const allowed = (target: number | null): boolean =>
            target !== null && membersValue(ctx.setting("allowedMembers")).includes(target);
        // Set while the message-level hook forwards an allowed beep to
        // ServerSend, so the backstop below does not inspect it twice
        let forwarding = false;
        // Every UI beep funnels through here - blocking before the send also
        // keeps the friend list's beep log from recording a "sent" beep
        ctx.hook("ServerSendBeepMessage", 6, (args, next) => {
            const target = typeof args[0] === "number" ? args[0] : null;
            if (allowed(target)) {
                forwarding = true;
                try {
                    return next(args);
                } finally {
                    forwarding = false;
                }
            }
            if (ctx.isEnforced()) {
                ctx.triggerAttempt(target);
                ctx.notify("A rule forbids you from sending beeps.");
                return;
            }
            ctx.trigger(target);
            forwarding = true;
            try {
                return next(args);
            } finally {
                forwarding = false;
            }
        });
        // Backstop for mods that send plain beeps directly
        ctx.hook("ServerSend", 6, (args, next) => {
            const [event, data] = args as unknown as [string, { BeepType?: string; MemberNumber?: number }];
            if (forwarding || event !== "AccountBeep"
                || (typeof data?.BeepType === "string" && data.BeepType !== "")) {
                return next(args);
            }
            const target = typeof data?.MemberNumber === "number" ? data.MemberNumber : null;
            if (allowed(target)) {
                return next(args);
            }
            if (ctx.isEnforced()) {
                ctx.triggerAttempt(target);
                return;
            }
            ctx.trigger(target);
            return next(args);
        });
    },
};

export const ForbidFriendListChanges: RuleDefinition = {
    id: "social.friendListChanges",
    name: "Forbid friend-list changes",
    description: "The player cannot add or remove BC friends; each direction can be "
        + "toggled separately. Covers the friend list screen and in-room dialogs.",
    category: "Social",
    announceAttempt: "{Name} tried to change the friend list, which a rule forbids.",
    announceViolation: "{Name} changed the friend list, which a rule forbids.",
    settings: [
        {
            type: "checkbox",
            name: "blockAdding",
            label: "Block adding friends",
            default: true,
        },
        {
            type: "checkbox",
            name: "blockRemoving",
            label: "Block removing friends",
            default: true,
        },
    ],
    load(ctx) {
        // Every add/remove path (friend list screen, chat room dialog, bulk
        // add prompt) flows through ChatRoomListUpdate on Player.FriendList
        ctx.hook("ChatRoomListUpdate", 6, (args, next) => {
            const [list, adding, memberNumber] = args;
            if (list === Player.FriendList
                && ((adding && ctx.setting<boolean>("blockAdding"))
                    || (!adding && ctx.setting<boolean>("blockRemoving")))) {
                const target = typeof memberNumber === "number" ? memberNumber : null;
                if (ctx.isEnforced()) {
                    ctx.triggerAttempt(target);
                    ctx.notify(adding
                        ? "A rule forbids you from adding friends."
                        : "A rule forbids you from removing friends.");
                    return;
                }
                ctx.trigger(target);
            }
            return next(args);
        });
    },
};
