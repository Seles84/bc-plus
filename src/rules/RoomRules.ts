import { RuleDefinition, RuleContext } from "@/system/rules/RuleTypes";
import { stringListValue } from "@/system/gui/Settings";

/**
 * Room control rules: creating rooms, entering rooms, and the room admin UI.
 * Enforcement happens at BC's screen/join entry points; moves initiated by
 * BC+ itself (summon, the go-to-room command) are deliberately not restricted
 * - those are already permission-gated on the operator.
 */

export const ForbidCreatingRooms: RuleDefinition = {
    id: "rooms.create",
    name: "Forbid creating new rooms",
    description: "The player cannot open the room creation screen. Changing settings of "
        + "an existing room they administrate is unaffected.",
    category: "Rooms",
    bcxEquivalent: "block_creating_rooms",
    load(ctx) {
        ctx.hook("CommonSetScreen", 5, (args, next) => {
            if (args[0] === "Online" && args[1] === "ChatAdmin" && ChatAdminMode === "create") {
                if (ctx.isEnforced()) {
                    ctx.triggerAttempt();
                    ctx.notify("A rule forbids you from creating chat rooms.");
                    return Promise.resolve();
                }
                ctx.trigger();
            }
            return next(args);
        });
    },
};

function allowedRooms(ctx: RuleContext): string[] {
    return stringListValue(ctx.setting<unknown>("allowedRooms"));
}

export const RestrictRoomEntry: RuleDefinition = {
    id: "rooms.entry",
    name: "Restrict entering rooms",
    description: "The player can only join rooms whose name is on the configured list "
        + "(case-insensitive). As a safety measure the rule does nothing while the list is "
        + "empty. Being moved by a BC+ command or summon is not restricted. Combines well "
        + "with \"Forbid creating new rooms\".",
    category: "Rooms",
    bcxEquivalent: "block_entering_rooms",
    announceViolation: "{Name} entered a room a rule does not allow.",
    settings: [{
        type: "stringList",
        name: "allowedRooms",
        label: "Allowed room names:",
        default: [],
        entryLabel: "room name",
        maxChars: 60,
    }],
    load(ctx) {
        ctx.hook("ChatSearchJoin", 5, (args, next) => {
            const rooms = allowedRooms(ctx);
            const roomName = args[0];
            if (rooms.length > 0 && ctx.inEffect() && typeof roomName === "string"
                && !rooms.some((name) => name.toLocaleLowerCase() === roomName.toLocaleLowerCase())) {
                if (ctx.isEnforced()) {
                    ctx.triggerAttempt();
                    ctx.notify("A rule does not allow you to enter this room.");
                    return;
                }
                ctx.trigger();
            }
            return next(args);
        });
    },
};

export const ForbidRoomAdminUI: RuleDefinition = {
    id: "rooms.adminUI",
    name: "Forbid room admin UI while blind",
    description: "The player cannot open the room administration screen while unable to see "
        + "- it would disclose the room background and admin member numbers. Admin chat "
        + "commands still work.",
    category: "Rooms",
    bcxEquivalent: "block_room_admin_UI",
    load(ctx) {
        // Silent blocker: BC renders the top-bar button in its Blocked state
        ctx.hook("ChatRoomMenuButtonVisualState", 6, (args, next) => {
            const result = next(args);
            if (args[0] === "RoomAdmin" && ctx.isEnforced() && Player.IsBlind()) {
                result.state = "Blocked";
            }
            return result;
        });
    },
};
