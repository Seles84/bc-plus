export interface ModuleConfig {
    /** Display name of the module */
    Name: string;
    Version: string;
    Author: string;
    Description: string;

    /** Inactive modules are registered but never loaded */
    Active: boolean;

    /** Icon path for GUI menus (relative to the asset base) */
    Icon: string;
    HoverText: string;

    /** Whether this module's data is shared with other BC+ users */
    PublicData: boolean;

    /** Unique slug used as storage key, hook owner id, and lookup reference */
    Reference: string;
    MenuString?: string;
}
