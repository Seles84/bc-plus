import { BCPLUS_VERSION } from "@/system/Constants";

/** Bumped only when the on-disk save format changes (not the data inside it). */
export const SAVE_FILE_VERSION = 1;
export const AUTH_STRING_SIZE = 16;

export enum StorageType {
    LocalStorage,
    ExtensionSettings,
}

export interface SaveFile {
    /** BC+ version that last wrote this save (used for update detection/migrations) */
    version: string;
    /** Per-module data, keyed by module slug */
    modules: Record<string, Record<string, unknown>>;
}

export function defaultSaveFile(): SaveFile {
    return {
        version: BCPLUS_VERSION,
        modules: {},
    };
}
