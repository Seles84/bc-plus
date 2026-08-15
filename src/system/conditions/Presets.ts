import { ConditionData, sanitizeConditions } from "@/system/conditions/Conditions";

/**
 * Named, reusable condition sets ("Quiet hours", "Public play", ...). They are
 * the editing player's personal library: stored in the Core module's private
 * data slice (never synced), and applicable to anything the conditions editor
 * opens on - own or remote rules, global conditions, curses, punishments.
 */
export interface ConditionPreset {
    name: string;
    conditions: ConditionData;
}

export const MAX_CONDITION_PRESETS = 20;
export const PRESET_NAME_MAX = 40;

/** The module data slice presets live in (Core's). */
interface PresetStore {
    Data: Record<string, unknown>;
}

export function getConditionPresets(store: PresetStore): ConditionPreset[] {
    const raw = store.Data.conditionPresets;
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw.filter((p): p is ConditionPreset =>
        typeof p === "object" && p !== null
        && typeof (p as ConditionPreset).name === "string"
        && typeof (p as ConditionPreset).conditions === "object"
        && (p as ConditionPreset).conditions !== null);
}

/** Saves (or overwrites, by name) a preset; false when invalid or the library is full. */
export function saveConditionPreset(store: PresetStore, name: string, conditions: ConditionData): boolean {
    const trimmed = name.trim().slice(0, PRESET_NAME_MAX);
    if (trimmed.length === 0) {
        return false;
    }
    const sanitized = sanitizeConditions(conditions) ?? {};
    // Presets never carry timers - an absolute end time is meaningless later
    delete sanitized.timerEnd;
    delete sanitized.timerAction;
    const presets = getConditionPresets(store).filter((p) => p.name !== trimmed);
    if (presets.length >= MAX_CONDITION_PRESETS) {
        return false;
    }
    presets.push({ name: trimmed, conditions: sanitized });
    store.Data.conditionPresets = presets;
    return true;
}

export function deleteConditionPreset(store: PresetStore, name: string): void {
    store.Data.conditionPresets = getConditionPresets(store).filter((p) => p.name !== name);
}

/** A preset applied onto existing conditions; the target keeps its running timer. */
export function applyConditionPreset(existing: ConditionData, preset: ConditionPreset): ConditionData {
    const applied: ConditionData = { ...(sanitizeConditions(preset.conditions) ?? {}) };
    delete applied.timerEnd;
    delete applied.timerAction;
    if (typeof existing.timerEnd === "number") {
        applied.timerEnd = existing.timerEnd;
        applied.timerAction = existing.timerAction;
    }
    return applied;
}
