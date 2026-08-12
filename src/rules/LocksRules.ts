import { RuleDefinition, RuleContext } from "@/system/rules/RuleTypes";

/**
 * Lock/key rules hide the relevant dialog buttons while enforced. Like the
 * protection pack these are silent blockers - DialogMenuButtonBuild runs every
 * frame, so the forbidden action's button simply never appears rather than
 * triggering repeatedly.
 */

type ButtonMatch = (button: string) => boolean;

/** Installs a rule that strips matching dialog buttons for self (ID 0) or others. */
function buttonBlockRule(
    id: string,
    name: string,
    description: string,
    onSelf: boolean,
    match: ButtonMatch,
    bcxEquivalent: string,
): RuleDefinition {
    return {
        id,
        name,
        description,
        category: "Items",
        bcxEquivalent,
        load(ctx: RuleContext) {
            ctx.hook("DialogMenuButtonBuild", 0, (args, next) => {
                const result = next(args);
                const character = args[0];
                if (ctx.isEnforced() && ((character.ID === 0) === onSelf)) {
                    for (let i = DialogMenuButton.length - 1; i >= 0; i--) {
                        if (match(DialogMenuButton[i]!)) {
                            DialogMenuButton.splice(i, 1);
                        }
                    }
                }
                return result;
            });
        },
    };
}

const isRemote: ButtonMatch = (b) => b === "Remote" || b.startsWith("RemoteDisabled");
const isUnlock: ButtonMatch = (b) => b === "Unlock";
const isPickLock: ButtonMatch = (b) => b.startsWith("PickLock");
const isLock: ButtonMatch = (b) => b === "Lock" || b === "LockMenu" || b === "LockDisabled";

export const ForbidRemotesSelf = buttonBlockRule(
    "locks.remotesSelf",
    "Forbid using remotes on self",
    "The player cannot use a vibrator remote on their own body. Others can still use remotes on them.",
    true, isRemote, "block_remoteuse_self",
);

export const ForbidRemotesOthers = buttonBlockRule(
    "locks.remotesOthers",
    "Forbid using remotes on others",
    "The player cannot use a vibrator remote on anyone else.",
    false, isRemote, "block_remoteuse_others",
);

export const ForbidKeysSelf = buttonBlockRule(
    "locks.keysSelf",
    "Forbid using keys on self",
    "The player cannot unlock locks on their own body, even with the key.",
    true, isUnlock, "block_keyuse_self",
);

export const ForbidKeysOthers = buttonBlockRule(
    "locks.keysOthers",
    "Forbid using keys on others",
    "The player cannot unlock locks on anyone else.",
    false, isUnlock, "block_keyuse_others",
);

export const ForbidPickSelf = buttonBlockRule(
    "locks.pickSelf",
    "Forbid picking locks on self",
    "The player cannot pick locks on their own body.",
    true, isPickLock, "block_lockpicking_self",
);

export const ForbidPickOthers = buttonBlockRule(
    "locks.pickOthers",
    "Forbid picking locks on others",
    "The player cannot pick locks on anyone else.",
    false, isPickLock, "block_lockpicking_others",
);

export const ForbidLockSelf = buttonBlockRule(
    "locks.lockSelf",
    "Forbid using locks on self",
    "The player cannot apply locks to their own body.",
    true, isLock, "block_lockuse_self",
);

export const ForbidLockOthers = buttonBlockRule(
    "locks.lockOthers",
    "Forbid using locks on others",
    "The player cannot apply locks to anyone else.",
    false, isLock, "block_lockuse_others",
);
