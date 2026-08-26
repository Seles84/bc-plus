interface SettingBase {
    /** Storage key inside the module's data slice */
    name: string;
    /** Text shown next to the widget */
    label: string;
    /** Hover description */
    hoverText?: string;
    /** Whether the setting is currently editable (default: always) */
    active?: () => boolean;
    /**
     * Section this setting belongs to on the module's settings page. Settings
     * sharing a category render under one header; modules without categories
     * keep the plain single list.
     */
    category?: string;
}

export interface CheckboxSetting extends SettingBase {
    type: "checkbox";
    default: boolean;
    onSet?: (value: boolean, prevValue: boolean) => void;
}

export interface OptionSetting extends SettingBase {
    type: "option";
    options: string[];
    /**
     * Optional icon path per option (same length as `options`; null entries
     * get a small text button). When present, rule config pages render the
     * option as a row of icon buttons with the selection highlighted, instead
     * of the back/next cycler.
     */
    icons?: (string | null)[];
    default: string;
    onSet?: (value: string, prevValue: string) => void;
}

export interface TextSetting extends SettingBase {
    type: "text";
    default: string;
    /** Maximum input length (default 256) */
    maxChars?: number;
    onSet?: (value: string, prevValue: string) => void;
}

export interface MembersSetting extends SettingBase {
    type: "members";
    default: number[];
}

export interface StringListSetting extends SettingBase {
    type: "stringList";
    default: string[];
    /** Maximum length per entry (default 200) */
    maxChars?: number;
    /** Maximum number of entries (default 50) */
    maxEntries?: number;
    /** Noun for one entry, shown in the editor ("word", "sentence", ...) */
    entryLabel?: string;
    /** Separator this setting used while it was a plain text field (for old saves) */
    legacySeparator?: string;
}

export type AnySetting = CheckboxSetting | OptionSetting | TextSetting | MembersSetting | StringListSetting;

/** Extracts `{ name: default }` records for merging into module defaults. */
export function settingDefaults(settings: AnySetting[]): Record<string, unknown> {
    // Array defaults are copied so stored values never share the declaration's array
    return Object.fromEntries(settings.map((s) => [s.name, Array.isArray(s.default) ? [...s.default] : s.default]));
}

/** Coerces a stored members value - number[] or a legacy comma string - to member numbers. */
export function membersValue(raw: unknown): number[] {
    if (Array.isArray(raw)) {
        return raw.filter((m): m is number => typeof m === "number" && Number.isInteger(m) && m >= 0);
    }
    if (typeof raw === "string") {
        return raw
            .split(",")
            .map((m) => Number.parseInt(m.trim(), 10))
            .filter((m) => Number.isInteger(m) && m >= 0);
    }
    return [];
}

/** Coerces a stored list value - string[] or a legacy separated string - to entries. */
export function stringListValue(raw: unknown, legacySeparator = ","): string[] {
    if (Array.isArray(raw)) {
        return raw
            .filter((s): s is string => typeof s === "string")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
    }
    if (typeof raw === "string") {
        return raw
            .split(legacySeparator)
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
    }
    return [];
}
