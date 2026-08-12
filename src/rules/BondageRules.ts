import { RuleDefinition, RuleContext } from "@/system/rules/RuleTypes";

/**
 * Rules controlling item use on bodies: tying, freeing and wardrobe access,
 * each in a self/others pair.
 *
 * Tying rules register a click-status callback on BC's item dialog so the
 * item grid buttons render disabled with a reason, mirroring BC's own
 * permission blocks. Freeing rules strip the Remove/Struggle/Dismount/Escape
 * dialog buttons like the lock rules do. Wardrobe rules gate BC's
 * Player.CanChangeClothesOn capability check.
 */

type ItemClickStatus = (C: Character, clickedObj: DialogInventoryItem, equippedItem?: null | Item) => null | string;

/** Registers a status callback on the item dialog grid; removed when the rule deactivates. */
function addItemClickStatus(ctx: RuleContext, key: string, callback: ItemClickStatus): void {
    // The instance is typed as a closed literal, but BC documents the record
    // as freely extensible ("Additional checks can be freely added here")
    const callbacks = DialogMenuMapping.items.clickStatusCallbacks as unknown as Record<string, ItemClickStatus>;
    callbacks[key] = callback;
    ctx.cleanup(() => {
        delete callbacks[key];
    });
}

function tyingRule(
    id: string,
    name: string,
    description: string,
    onSelf: boolean,
    settings: RuleDefinition["settings"],
    applies: (ctx: RuleContext, C: Character) => boolean,
): RuleDefinition {
    const noun = onSelf ? "themselves" : "someone";
    return {
        id,
        name,
        description,
        category: "Items",
        bcxEquivalent: onSelf ? "block_tying_self" : "block_tying_others",
        settings,
        announceAttempt: `{Name} tried to use an item on ${noun}, which a rule forbids.`,
        announceViolation: `{Name} used an item on ${noun}, which a rule forbids.`,
        load(ctx) {
            addItemClickStatus(ctx, `BCPlus_${id}`, (C) =>
                ctx.isEnforced() && applies(ctx, C) ? `Blocked by BC+ rule: "${name}"` : null);
            ctx.hook("DialogMenuMapping.items._ClickButton", 0, (args, next) => {
                const C = args[1];
                if (ctx.inEffect() && !ctx.isEnforced() && applies(ctx, C)) {
                    ctx.trigger(onSelf ? undefined : C.MemberNumber);
                }
                return next(args);
            });
            ctx.hook("DialogMenuMapping.items.eventListeners._ClickDisabledButton", 0, (args, next) => {
                const C = DialogMenuMapping.items.C;
                if (ctx.isEnforced() && C && applies(ctx, C)) {
                    ctx.triggerAttempt(onSelf ? undefined : C.MemberNumber);
                }
                return next(args);
            });
        },
    };
}

export const ForbidTyingSelf = tyingRule(
    "items.tyingSelf",
    "Forbid tying up self",
    "The player cannot use items on their own body, including swapping worn items.",
    true,
    undefined,
    (_ctx, C) => C.IsPlayer(),
);

export const ForbidTyingOthers = tyingRule(
    "items.tyingOthers",
    "Forbid tying up others",
    "The player cannot use items on other characters. Can be limited to characters "
        + "with a higher dominant score than the player.",
    false,
    [{
        type: "checkbox",
        name: "onlyDominants",
        label: "Only forbid using items on more dominant characters",
        default: true,
    }],
    (ctx, C) => !C.IsPlayer() && (!ctx.setting<boolean>("onlyDominants")
        || ReputationCharacterGet(Player, "Dominant") < ReputationCharacterGet(C, "Dominant")),
);

const FREEING_BUTTONS = new Set<string>(["Remove", "Struggle", "Dismount", "Escape"]);

/** Total difficulty score of the item in the focused slot, or null when the slot is empty. */
function focusedItemDifficulty(character: Character): number | null {
    if (!character.FocusGroup) {
        return null;
    }
    const item = InventoryGet(character, character.FocusGroup.Name);
    if (!item) {
        return null;
    }
    return (item.Asset.Difficulty ?? 0)
        + (typeof item.Property?.Difficulty === "number" ? item.Property.Difficulty : 0);
}

/**
 * Silent blocker in the LocksRules style: the freeing buttons simply never
 * appear. Swapping the worn item for another is not covered here - enable
 * "Forbid tying up self" to block that too.
 */
function freeingRule(id: string, name: string, description: string, onSelf: boolean): RuleDefinition {
    return {
        id,
        name,
        description,
        category: "Items",
        bcxEquivalent: onSelf ? "block_freeing_self" : "block_freeing_others",
        settings: [{
            type: "checkbox",
            name: "allowEasy",
            label: "Still allow removing low-difficulty items",
            default: false,
        }],
        load(ctx) {
            ctx.hook("DialogMenuButtonBuild", 0, (args, next) => {
                const result = next(args);
                const character = args[0];
                if (ctx.isEnforced() && ((character.ID === 0) === onSelf)) {
                    const difficulty = focusedItemDifficulty(character);
                    if (ctx.setting<boolean>("allowEasy") && difficulty !== null && difficulty <= 1) {
                        return result;
                    }
                    for (let i = DialogMenuButton.length - 1; i >= 0; i--) {
                        if (FREEING_BUTTONS.has(DialogMenuButton[i]!)) {
                            DialogMenuButton.splice(i, 1);
                        }
                    }
                }
                return result;
            });
        },
    };
}

export const ForbidFreeingSelf = freeingRule(
    "items.freeingSelf",
    "Forbid freeing self",
    "The player cannot remove, struggle out of or escape items on their own body. "
        + "Others can still remove them. Low-difficulty items (hand-held toys, plushies...) "
        + "can optionally stay removable.",
    true,
);

export const ForbidFreeingOthers = freeingRule(
    "items.freeingOthers",
    "Forbid freeing others",
    "The player cannot remove items from other characters. Low-difficulty items "
        + "(hand-held toys, plushies...) can optionally stay removable.",
    false,
);

function wardrobeRule(id: string, name: string, description: string, onSelf: boolean): RuleDefinition {
    return {
        id,
        name,
        description,
        category: "Items",
        bcxEquivalent: onSelf ? "block_wardrobe_access_self" : "block_wardrobe_access_others",
        announceViolation: onSelf
            ? "{Name} used their wardrobe, which a rule forbids."
            : "{Name} used someone's wardrobe, which a rule forbids.",
        load(ctx) {
            ctx.hook("Player.CanChangeClothesOn", 2, (args, next) => {
                const target = args[0];
                if (ctx.isEnforced() && (target.IsPlayer() === onSelf)) {
                    return false;
                }
                return next(args);
            });
            // With enforcement on, BC never opens the appearance editor - so
            // reaching it while the rule is unenforced is a loggable violation
            ctx.hook("CharacterAppearanceLoadCharacter", 0, (args, next) => {
                const C = args[0];
                if (ctx.inEffect() && !ctx.isEnforced() && ((C.ID === 0) === onSelf)) {
                    ctx.trigger(onSelf ? undefined : C.MemberNumber);
                }
                return next(args);
            });
        },
    };
}

export const ForbidWardrobeSelf = wardrobeRule(
    "items.wardrobeSelf",
    "Forbid wardrobe use on self",
    "The player cannot change their own clothes. Others can still change them.",
    true,
);

export const ForbidWardrobeOthers = wardrobeRule(
    "items.wardrobeOthers",
    "Forbid wardrobe use on others",
    "The player cannot change the clothes of other club members.",
    false,
);
