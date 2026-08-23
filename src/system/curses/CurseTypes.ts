import { jsonClone } from "@/utils/BCUtils";

/** One item permitted in a cursed slot, with its own enforcement rules. */
export interface CurseItemSpec {
    /** Asset name within the group */
    asset: string;
    /** Display name (craft name or asset description at capture time) */
    name: string;
    /**
     * Strict specs restore the captured color/properties/craft exactly;
     * loose specs only require the same asset (any color/type allowed).
     */
    strict: boolean;
    color?: ItemColor;
    difficulty?: number;
    property?: ItemProperties;
    craft?: CraftingItem;
}

/**
 * A cursed slot: a list of allowed items, each with its own rules.
 * - items non-empty: only listed items may be worn (violations restore items[0])
 * - items empty + allowEmpty: the slot is cursed empty (anything worn is removed)
 * - allowEmpty: whether a bare slot is acceptable
 */
export interface CurseSlotData {
    group: AssetGroupName;
    active: boolean;
    allowEmpty: boolean;
    items: CurseItemSpec[];
    /** Padlock the worn allowed item must carry (CURSE_LOCKS asset); absent = locks are not the curse's business */
    lock?: string;
    /** When the curse is in effect; absent = always while active */
    conditions?: import("@/system/conditions/Conditions").ConditionData;
    /** Who placed the curse */
    addedBy?: import("@/system/module/ModuleTypes").Originator;
}

/** Padlocks a cursed slot can enforce (validated again target-side on remote edits). */
export const CURSE_LOCKS: readonly { asset: string; label: string }[] = [
    { asset: "", label: "No lock" },
    { asset: "MetalPadlock", label: "Metal padlock" },
    { asset: "IntricatePadlock", label: "Intricate padlock" },
    { asset: "ExclusivePadlock", label: "Exclusive padlock" },
    { asset: "OwnerPadlock", label: "Owner padlock" },
    { asset: "LoverPadlock", label: "Lover padlock" },
];

/** Whether a lock choice makes sense on this wearer right now (Owner/Lover locks need one). */
export function lockApplicableFor(C: Character, lock: string): boolean {
    if (lock === "OwnerPadlock") {
        return C.Ownership?.MemberNumber != null;
    }
    if (lock === "LoverPadlock") {
        try {
            return C.GetLoversNumbers().length > 0;
        } catch {
            return false;
        }
    }
    return true;
}

/** Property keys that change on their own and must not count as violations. */
const VOLATILE_PROPERTY_KEYS = ["RemoveTimer", "ShowTimer", "MemberNumber", "LockMemberNumber"];

/**
 * Every lock-related property key (BC's ValidationAllLockProperties). Lock state
 * is the slot's `lock` setting's business, never part of an item spec: specs
 * neither capture nor compare it, so re-locking with a different-but-valid lock
 * is not a "wrong state" violation and stale lock props are never restored.
 */
const LOCK_PROPERTY_KEYS = [
    "LockedBy", "LockMemberNumber", "LockMemberName", "LockMessage",
    "EnableRandomInput", "RemoveItem", "ShowTimer", "CombinationNumber", "Password", "Hint", "LockSet", "LockPickSeed",
    "MemberNumberList", "RemoveTimer", "MemberNumberListKeys",
];

/** Removes all lock state from a property object; undefined when nothing else remains. */
export function stripLockState(property: ItemProperties | undefined): ItemProperties | undefined {
    if (!property || typeof property !== "object") {
        return undefined;
    }
    const copy: Record<string, unknown> = { ...(property as Record<string, unknown>) };
    for (const key of LOCK_PROPERTY_KEYS) {
        delete copy[key];
    }
    // Locks also inject "Lock" into Effect - drop it (and an emptied array)
    if (Array.isArray(copy.Effect)) {
        const effect = (copy.Effect as unknown[]).filter((e) => e !== "Lock");
        if (effect.length === 0) {
            delete copy.Effect;
        } else {
            copy.Effect = effect;
        }
    }
    return Object.keys(copy).length === 0 ? undefined : (copy as ItemProperties);
}

function comparableProperty(property: ItemProperties | undefined): Record<string, unknown> {
    const stripped = stripLockState(property);
    if (!stripped) {
        return {};
    }
    const copy: Record<string, unknown> = { ...(stripped as Record<string, unknown>) };
    for (const key of VOLATILE_PROPERTY_KEYS) {
        delete copy[key];
    }
    return copy;
}

/** Serializes with sorted object keys, so key order can never cause a false mismatch. */
function canonicalJSON(value: unknown): string {
    return JSON.stringify(value ?? null, (_key, v: unknown) => {
        if (v && typeof v === "object" && !Array.isArray(v)) {
            return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
        }
        return v;
    });
}

function sameJSON(a: unknown, b: unknown): boolean {
    return canonicalJSON(a) === canonicalJSON(b);
}

/** Captures the currently worn item as an allowed spec (lock state excluded by design). */
export function captureItemSpec(item: Item, strict: boolean): CurseItemSpec {
    return {
        asset: item.Asset.Name,
        name: item.Craft?.Name || item.Asset.Description,
        strict,
        color: jsonClone(item.Color) ?? undefined,
        difficulty: item.Difficulty,
        property: stripLockState(jsonClone(item.Property) ?? undefined),
        craft: jsonClone(item.Craft) ?? undefined,
    };
}

/**
 * Re-captures a spec's snapshot from the item as actually worn. Called after a
 * restore so enforcement converges: capture/restore asymmetries (default colors,
 * asset-added properties) would otherwise mismatch forever and cause fight loops.
 */
export function adoptRestoredState(spec: CurseItemSpec, item: Item): void {
    spec.color = jsonClone(item.Color) ?? undefined;
    spec.difficulty = item.Difficulty;
    spec.property = stripLockState(jsonClone(item.Property) ?? undefined);
    spec.craft = jsonClone(item.Craft) ?? undefined;
}

/** Whether a worn item satisfies a spec (asset match, plus exact state when strict). */
export function itemMatchesSpec(item: Item, spec: CurseItemSpec): boolean {
    if (item.Asset.Name !== spec.asset) {
        return false;
    }
    if (!spec.strict) {
        return true;
    }
    return sameJSON(item.Color, spec.color)
        && sameJSON(comparableProperty(item.Property), comparableProperty(spec.property))
        && sameJSON(item.Craft ?? null, spec.craft ?? null);
}
