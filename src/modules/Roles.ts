import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig, PermissionDefinition } from "@/system/module/ModuleTypes";
import { BCPLUS_AUTHOR, BCPLUS_VERSION } from "@/system/Constants";
import { Role } from "@/system/Roles";
import { GUIScreen } from "@/system/gui/GUIScreen";
import { RolesScreen } from "@/gui/RolesScreen";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";

/** Storage keys for the manually assigned role lists. BC Owner and Lover are never manual. */
export const MANUAL_ROLE_KEYS = {
    [Role.Owner]: "owners",
    [Role.Mistress]: "mistresses",
} as const;

export type ManualRole = keyof typeof MANUAL_ROLE_KEYS;

/**
 * A custom role: NOT a rank in the hierarchy - a named bundle of permission
 * grants plus a member list. Grants are purely additive (union with the
 * hierarchy check); custom roles can never outrank BC Owner because they
 * do not rank at all, and deny rules deliberately do not exist.
 */
export interface CustomRoleData {
    name: string;
    members: number[];
    grants: string[];
}

const MAX_CUSTOM_ROLES = 12;
const MAX_ROLE_NAME = 30;

/**
 * Determines which BC+ roles a member holds, combining BC relationships
 * (ownership, lovership, whitelist, friends) with manually assigned lists.
 */
export default class Roles extends ModuleInstance {

    protected readonly SystemConfig: ModuleConfig = {
        Name: "Roles",
        Version: BCPLUS_VERSION,
        Author: BCPLUS_AUTHOR,
        Description: "Assign BC+ roles to other players",
        Active: true,
        Icon: "Icons/Security.png",
        HoverText: "Manage who holds BC+ roles: BC Owner and Lover always follow your actual in-game "
            + "relationships and cannot be assigned. Owner and Mistress are assigned on this screen. "
            + "Whitelist and Friend follow your BC lists directly.",
        PublicData: true,
        Reference: "roles",
        MenuString: "Roles",
    };

    override get Permissions(): PermissionDefinition[] {
        return [{
            id: "roles.manage",
            label: "Manage role assignments",
            defaultRole: Role.Owner,
            defaultSelf: true,
        }];
    }

    override get Defaults(): Record<string, unknown> {
        return {
            owners: [],
            mistresses: [],
            customRoles: {},
        };
    }

    override get HasGUI(): boolean {
        return true;
    }

    override get SettingsScreen(): ((character: BCPlusCharacter | null) => GUIScreen) | null {
        return (character) => new RolesScreen(this, character);
    }

    /** Members manually assigned to the given role (mutable, auto-synced). */
    manualList(role: ManualRole): number[] {
        return this.Data[MANUAL_ROLE_KEYS[role]] as number[];
    }

    /** Members holding the role through BC itself (read-only). */
    derivedList(role: Role): number[] {
        switch (role) {
            case Role.BCOwner:
                return Player.Ownership ? [Player.Ownership.MemberNumber] : [];
            case Role.Lover:
                return Player.Lovership
                    .map((l) => l.MemberNumber)
                    .filter((m): m is number => typeof m === "number");
            default:
                return [];
        }
    }

    /** Every role the member holds. Always includes Public. */
    rolesOf(memberNumber: number): Role[] {
        const roles: Role[] = [Role.Public];
        if (this.derivedList(Role.BCOwner).includes(memberNumber)) {
            roles.push(Role.BCOwner);
        }
        if (this.derivedList(Role.Lover).includes(memberNumber)) {
            roles.push(Role.Lover);
        }
        for (const role of [Role.Owner, Role.Mistress] as ManualRole[]) {
            if (this.manualList(role).includes(memberNumber)) {
                roles.push(role);
            }
        }
        if (Player.WhiteList.includes(memberNumber)) {
            roles.push(Role.Whitelist);
        }
        if (Player.FriendList.includes(memberNumber)) {
            roles.push(Role.Friend);
        }
        return roles.sort((a, b) => a - b);
    }

    /** The member's highest role (lowest enum value). */
    highestRole(memberNumber: number): Role {
        return this.rolesOf(memberNumber)[0] ?? Role.Public;
    }

    // --- Custom roles (grant bundles, not ranks) ---

    get CustomRoles(): Record<string, CustomRoleData> {
        return this.Data.customRoles as Record<string, CustomRoleData>;
    }

    getCustomRole(id: string): CustomRoleData | undefined {
        return this.CustomRoles[id];
    }

    /** Creates a custom role; returns its id, or null when invalid/at cap. */
    createCustomRole(name: string): string | null {
        const trimmed = name.trim().slice(0, MAX_ROLE_NAME);
        if (trimmed.length === 0 || Object.keys(this.CustomRoles).length >= MAX_CUSTOM_ROLES) {
            return null;
        }
        const id = `cr${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
        this.CustomRoles[id] = { name: trimmed, members: [], grants: [] };
        return id;
    }

    deleteCustomRole(id: string): void {
        delete this.CustomRoles[id];
    }

    setCustomRoleGrant(id: string, permission: string, granted: boolean): void {
        const role = this.CustomRoles[id];
        if (!role) {
            return;
        }
        const index = role.grants.indexOf(permission);
        if (granted && index === -1) {
            role.grants.push(permission);
        } else if (!granted && index !== -1) {
            role.grants.splice(index, 1);
        }
    }

    /** Every permission the member holds through custom roles (additive only). */
    customGrantsOf(memberNumber: number): Set<string> {
        const grants = new Set<string>();
        for (const role of Object.values(this.CustomRoles)) {
            if (Array.isArray(role.members) && role.members.includes(memberNumber)) {
                for (const grant of role.grants ?? []) {
                    grants.add(grant);
                }
            }
        }
        return grants;
    }
}
