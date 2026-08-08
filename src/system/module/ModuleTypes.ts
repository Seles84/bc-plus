import { Role } from "@/system/Roles";

/** A permission a module exposes for Authority to manage. */
export interface PermissionDefinition {
    /** Globally unique id, conventionally `<module>.<action>` (e.g. `rules.edit`) */
    id: string;
    /** Human-readable description shown in the Authority settings */
    label: string;
    /** Lowest role granted this permission by default */
    defaultRole: Role;
    /** Whether the player may perform this on themselves by default */
    defaultSelf: boolean;
}

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
