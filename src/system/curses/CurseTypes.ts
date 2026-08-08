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
}

/** Property keys that change on their own and must not count as violations. */
const VOLATILE_PROPERTY_KEYS = ["RemoveTimer", "ShowTimer", "MemberNumber", "LockMemberNumber"];

function comparableProperty(property: ItemProperties | undefined): Record<string, unknown> {
    if (!property || typeof property !== "object") {
        return {};
    }
    const copy: Record<string, unknown> = { ...(property as Record<string, unknown>) };
    for (const key of VOLATILE_PROPERTY_KEYS) {
        delete copy[key];
    }
    return copy;
}

function sameJSON(a: unknown, b: unknown): boolean {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Captures the currently worn item as an allowed spec. */
export function captureItemSpec(item: Item, strict: boolean): CurseItemSpec {
    return {
        asset: item.Asset.Name,
        name: item.Craft?.Name || item.Asset.Description,
        strict,
        color: structuredClone(item.Color) ?? undefined,
        difficulty: item.Difficulty,
        property: structuredClone(item.Property) ?? undefined,
        craft: structuredClone(item.Craft) ?? undefined,
    };
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
