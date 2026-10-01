import { RuleDefinition } from "@/system/rules/RuleTypes";
import { Role, roleFromName } from "@/system/Roles";
import { SendAction } from "@/utils/Messaging";
import { stringListValue } from "@/system/gui/Settings";

/**
 * Commands no rule may ever block, whatever the configuration says: the
 * safeword is the consent escape hatch, and /bcp is how the wearer sees and
 * (where permitted) manages their own rules. Checked at enforcement, so no
 * stored list, import code or remote edit can make these entries effective.
 */
const NEVER_BLOCKED_COMMANDS = new Set(["safeword", "bcp", "help"]);

/** First command token of a parsed chat command, without the leading key. */
function chatCommandName(msg: string): string {
    return msg.slice(1).split(/\s/, 1)[0]?.toLowerCase() ?? "";
}

/** The player cannot change their multiplayer difficulty. */
export const ForbidDifficultyChange: RuleDefinition = {
    id: "control.difficulty",
    name: "Forbid changing difficulty",
    description: "The player cannot change their Bondage Club multiplayer difficulty, "
        + "whatever it currently is.",
    category: "Other",
    bcxEquivalent: "block_difficulty_change",
    load(ctx) {
        ctx.hook("PreferenceSubscreenDifficultyConfirm", 5, (args, next) => {
            if (ctx.inEffect() && PreferenceDifficultyLevel !== null
                && PreferenceDifficultyLevel !== Player.GetDifficulty()) {
                if (ctx.isEnforced()) {
                    ctx.triggerAttempt();
                    ctx.notify("A rule forbids you from changing your difficulty.");
                    return;
                }
                ctx.trigger();
            }
            return next(args);
        });
    },
};

/** Configured slash commands are disabled for the player. */
export const ForbidCommands: RuleDefinition = {
    id: "control.commands",
    name: "Forbid chat commands",
    description: "The configured slash commands are disabled for the player (for example "
        + "wardrobe, friendlist, beep - without the slash). The safeword and /bcp can never "
        + "be blocked: entries for them are ignored.",
    category: "Other",
    announceAttempt: "{Name} tried to use a command a rule forbids.",
    settings: [{
        type: "stringList",
        name: "commands",
        label: "Blocked commands:",
        default: [],
        entryLabel: "command",
        maxChars: 30,
    }],
    load(ctx) {
        // CommandExecute only ever sees real slash commands (CommandParse
        // routes plain chat and escaped input past it), and returning true
        // swallows the command exactly like a handled one
        ctx.hook("CommandExecute", 5, (args, next) => {
            const msg = args[0];
            if (typeof msg === "string" && ctx.inEffect()) {
                const name = chatCommandName(msg);
                const blocked = stringListValue(ctx.setting<unknown>("commands"))
                    .map((entry) => entry.replace(/^\//, "").trim().toLowerCase());
                if (name.length > 0 && !NEVER_BLOCKED_COMMANDS.has(name) && blocked.includes(name)) {
                    if (ctx.isEnforced()) {
                        ctx.triggerAttempt();
                        ctx.notify(`A rule forbids you from using /${name}.`);
                        return true;
                    }
                    ctx.trigger();
                }
            }
            return next(args);
        });
    },
};

/** The activities button disappears from the player's item dialogs. */
export const ForbidActivities: RuleDefinition = {
    id: "control.activities",
    name: "Forbid using activities",
    description: "The player cannot use any (sexual) activities on anyone - the activities "
        + "button vanishes from the item dialogs. Others can still use activities on the "
        + "player; the arousal system itself stays untouched.",
    category: "Other",
    bcxEquivalent: "block_activities",
    load(ctx) {
        ctx.hook("DialogMenuButtonBuild", 2, (args, next) => {
            const result = next(args);
            if (ctx.isEnforced()) {
                const index = DialogMenuButton.indexOf("Activity");
                if (index >= 0) {
                    DialogMenuButton.splice(index, 1);
                }
            }
            return result;
        });
    },
};

/** The player cannot show, change or remove their emoticon. */
export const ForbidEmoticonChange: RuleDefinition = {
    id: "control.emoticon",
    name: "Forbid changing emoticon",
    description: "The player cannot show, change or remove the emoticon (afk, sleep, ...) "
        + "over their own head.",
    category: "Social",
    bcxEquivalent: "block_changing_emoticon",
    load(ctx) {
        ctx.hook("DialogSelfMenuMapping.Expression._ClickButton", 5, (args, next) => {
            const C = args[1] as Character;
            const pair = args[2] as { Group?: string } | undefined;
            if (C.IsPlayer() && ctx.inEffect() && pair?.Group === "Emoticon") {
                if (ctx.isEnforced()) {
                    ctx.triggerAttempt();
                    return 'Blocked by BC+ rule: "Forbid changing emoticon"';
                }
                ctx.trigger();
            }
            return next(args);
        });
    },
};

const LEASH_ROLE_OPTIONS = ["BC Owner", "Co-Owner", "Lover", "Mistress", "Whitelist", "Friend"];

/** Only sufficiently ranked people can put the player on a leash. */
export const RestrictLeashing: RuleDefinition = {
    id: "control.leash",
    name: "Restrict who may leash",
    description: "Only people of at least the configured BC+ role can take the player onto a "
        + "leash; everyone else's leash slips off with a room message.",
    category: "Protection",
    bcxEquivalent: "alt_restrict_leashability",
    settings: [{
        type: "option",
        name: "minimumRole",
        label: "Leashing needs at least:",
        default: "Co-Owner",
        options: LEASH_ROLE_OPTIONS,
    }],
    load(ctx) {
        ctx.hook("ChatRoomCanBeLeashedBy", 4, (args, next) => {
            const [sourceMemberNumber, C] = args as unknown as [number, Character];
            if (!ctx.isEnforced() || !C?.IsPlayer()
                || sourceMemberNumber === 0 || sourceMemberNumber === Player.MemberNumber) {
                return next(args);
            }
            const threshold = roleFromName(ctx.setting<string>("minimumRole")) ?? Role.Owner;
            if (ctx.highestRoleOf(sourceMemberNumber) <= threshold) {
                return next(args);
            }
            ctx.triggerAttempt(sourceMemberNumber);
            if (ServerPlayerIsInChatRoom()) {
                const source = ChatRoomCharacter.find((ch) => ch.MemberNumber === sourceMemberNumber);
                const sourceName = source ? (source.Nickname || source.Name) : `#${sourceMemberNumber}`;
                SendAction(`${Player.Nickname || Player.Name}'s leash slips out of ${sourceName}'s hand.`);
            }
            return false;
        });
    },
};

const NICKNAME_CHECK_MS = 3000;

/** Forces (or freezes) the player's BC nickname. */
export const ControlNickname: RuleDefinition = {
    id: "control.nickname",
    name: "Control nickname",
    description: "Locks the player's BC nickname: with a nickname configured it is forced to "
        + "that; with the field left empty the nickname the player had when the rule took hold "
        + "is kept. The nickname stays as-is when the rule ends.",
    category: "Social",
    bcxEquivalent: "alt_set_nickname",
    settings: [{
        type: "text",
        name: "nickname",
        label: "Forced nickname (empty = lock current):",
        default: "",
        maxChars: 20,
    }],
    load(ctx) {
        // Captured fresh whenever the rule installs; an empty setting locks
        // whatever the nickname was at that moment
        const captured = Player.Nickname ?? "";
        ctx.interval(() => {
            if (!ctx.isEnforced() || typeof Player === "undefined" || !Player.MemberNumber || !ServerIsConnected) {
                return;
            }
            let desired = ctx.setting<string>("nickname").trim();
            if (desired === "") {
                desired = captured;
            }
            if (desired !== "" && !ServerCharacterNicknameRegex.test(desired)) {
                return;
            }
            if ((Player.Nickname ?? "") !== desired) {
                Player.Nickname = desired;
                ServerAccountUpdate.QueueData({ Nickname: desired }, true);
                ctx.notify("A rule keeps your nickname in place.");
            }
        }, NICKNAME_CHECK_MS);
    },
};

const PROFILE_CHECK_MS = 5000;

/** The player's profile description is frozen as it was when the rule took hold. */
export const LockProfileDescription: RuleDefinition = {
    id: "control.profile",
    name: "Lock profile description",
    description: "Freezes the player's online profile description: any change is reverted to "
        + "the text it had when the rule took hold. The description stays as-is when the "
        + "rule ends.",
    category: "Social",
    bcxEquivalent: "alt_set_profile_description",
    load(ctx) {
        const captured = Player.Description || "";
        ctx.interval(() => {
            if (!ctx.isEnforced() || typeof Player === "undefined" || !Player.MemberNumber || !ServerIsConnected) {
                return;
            }
            if ((Player.Description || "") === captured) {
                return;
            }
            Player.Description = captured;
            // BC stores long descriptions LZString-compressed with a marker
            let stored = captured;
            const compressed = `╬${LZString.compressToUTF16(captured)}`;
            if (compressed.length < captured.length || captured.startsWith("╬")) {
                stored = compressed;
            }
            ServerAccountUpdate.QueueData({ Description: stored });
            ctx.triggerAttempt();
            ctx.notify("A rule keeps your profile description in place.");
        }, PROFILE_CHECK_MS);
    },
};
