import { RuleDefinition } from "@/system/rules/RuleTypes";
import { Role, RoleNames } from "@/system/Roles";

/**
 * Protection rules guard relationship and list state against impulsive or
 * coerced changes. The relationship rules hook BC's capability checks, which
 * run every dialog frame - so they block silently (the option simply never
 * appears) and cannot trigger/announce without spamming.
 */

export const ForbidOwnerChanges: RuleDefinition = {
    id: "protect.ownerChanges",
    name: "Forbid club owner changes",
    description: "The player cannot leave their current club owner or submit to a new one. "
        + "Advancing a trial to full ownership is unaffected, and their owner can still release them.",
    category: "Protection",
    load(ctx) {
        ctx.hook("ChatRoomOwnershipOptionIs", 5, (args, next) => {
            if (ctx.isEnforced() && args[0] === "CanStartTrial") {
                return false;
            }
            return next(args);
        });
        for (const fn of [
            "ManagementCanBeReleasedOnline",
            "ManagementCanBreakTrialOnline",
            "ManagementCannotBeReleasedOnline",
            "ManagementCanBeReleased",
            "ManagementCannotBeReleased",
        ] as const) {
            ctx.hook(fn, 5, (args, next) => !ctx.isEnforced() && next(args));
        }
        ctx.hook("ManagementCannotBeReleasedExtreme", 5, (args, next) => ctx.isEnforced() || next(args));
    },
};

export const ForbidNewLovers: RuleDefinition = {
    id: "protect.newLovers",
    name: "Forbid getting new lovers",
    description: "The player cannot start dating anyone new. Advancing an existing lovership "
        + "(dating to engagement to marriage) is unaffected.",
    category: "Protection",
    load(ctx) {
        ctx.hook("ChatRoomLovershipOptionIs", 5, (args, next) => {
            if (ctx.isEnforced() && (args[0] === "CanOfferBeginDating" || args[0] === "CanBeginDating")) {
                return false;
            }
            return next(args);
        });
    },
};

export const ForbidBreakingUp: RuleDefinition = {
    id: "protect.breakup",
    name: "Forbid breaking up with lovers",
    description: "The player cannot leave any of their lovers, at any lovership stage. "
        + "Their lovers can still break up with them.",
    category: "Protection",
    load(ctx) {
        for (const fn of [
            "ManagementCanBreakDatingLoverOnline",
            "ManagementCanBreakUpLoverOnline",
        ] as const) {
            ctx.hook(fn, 5, (args, next) => !ctx.isEnforced() && next(args));
        }
    },
};

export const ForbidNewSubmissives: RuleDefinition = {
    id: "protect.newSubs",
    name: "Forbid taking new submissives",
    description: "The player cannot offer an ownership trial to a new submissive. "
        + "Advancing an existing trial to full ownership is unaffected.",
    category: "Protection",
    load(ctx) {
        ctx.hook("ChatRoomOwnershipOptionIs", 5, (args, next) => {
            if (ctx.isEnforced() && args[0] === "CanOfferStartTrial") {
                return false;
            }
            return next(args);
        });
    },
};

export const ForbidDisowning: RuleDefinition = {
    id: "protect.disowning",
    name: "Forbid disowning submissives",
    description: "The player cannot let go of any of their submissives (trial or full ownership). "
        + "Their submissives can still break the bond themselves.",
    category: "Protection",
    load(ctx) {
        ctx.hook("ChatRoomIsOwnedByPlayer", 5, (args, next) => !ctx.isEnforced() && next(args));
    },
};

const PROTECT_ROLE_OPTIONS = RoleNames.slice(0, 6) as string[]; // BC Owner .. Friend

export const PreventBlacklisting: RuleDefinition = {
    id: "protect.blacklist",
    name: "Prevent blacklisting",
    description: "The player cannot add people holding the configured role (or higher) to their "
        + "BC blacklist or ghostlist.",
    category: "Protection",
    announceAttempt: "{Name} tried to blacklist someone a rule protects.",
    settings: [{
        type: "option",
        name: "minRole",
        label: "Protect this role and higher",
        options: [...PROTECT_ROLE_OPTIONS],
        default: "Mistress",
    }],
    load(ctx) {
        ctx.hook("ChatRoomListUpdate", 6, (args, next) => {
            const [list, adding, memberNumber] = args;
            const protectedRole = RoleNames.indexOf(ctx.setting<string>("minRole"));
            if (ctx.isEnforced()
                && adding
                && (list === Player.BlackList || list === Player.GhostList)
                && typeof memberNumber === "number"
                && protectedRole >= 0
                && ctx.highestRoleOf(memberNumber) <= (protectedRole as Role)) {
                ctx.triggerAttempt(memberNumber);
                ctx.notify("A rule protects this person from being blacklisted.");
                return;
            }
            return next(args);
        });
    },
};

export const PreventWhitelisting: RuleDefinition = {
    id: "protect.whitelist",
    name: "Prevent whitelisting",
    description: "The player can only add people holding the configured role (or higher) to their "
        + "BC whitelist.",
    category: "Protection",
    announceAttempt: "{Name} tried to whitelist someone a rule does not allow.",
    settings: [{
        type: "option",
        name: "minRole",
        label: "Lowest role allowed on the whitelist",
        options: [...PROTECT_ROLE_OPTIONS],
        default: "Mistress",
    }],
    load(ctx) {
        ctx.hook("ChatRoomListUpdate", 6, (args, next) => {
            const [list, adding, memberNumber] = args;
            const minRole = RoleNames.indexOf(ctx.setting<string>("minRole"));
            if (ctx.isEnforced()
                && adding
                && list === Player.WhiteList
                && typeof memberNumber === "number"
                && minRole >= 0
                && ctx.highestRoleOf(memberNumber) > (minRole as Role)) {
                ctx.triggerAttempt(memberNumber);
                ctx.notify("A rule does not allow whitelisting this person.");
                return;
            }
            return next(args);
        });
    },
};
