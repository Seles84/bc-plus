interface SettingBase {
    /** Storage key inside the module's data slice */
    name: string;
    /** Text shown next to the widget */
    label: string;
    /** Hover description */
    hoverText?: string;
    /** Whether the setting is currently editable (default: always) */
    active?: () => boolean;
}

export interface CheckboxSetting extends SettingBase {
    type: "checkbox";
    default: boolean;
    onSet?: (value: boolean, prevValue: boolean) => void;
}

export interface OptionSetting extends SettingBase {
    type: "option";
    options: string[];
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

export type AnySetting = CheckboxSetting | OptionSetting | TextSetting;

/** Extracts `{ name: default }` records for merging into module defaults. */
export function settingDefaults(settings: AnySetting[]): Record<string, unknown> {
    return Object.fromEntries(settings.map((s) => [s.name, s.default]));
}
