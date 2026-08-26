import menuIcon from "@/assets/icons/roles.png";
import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig, PermissionDefinition } from "@/system/module/ModuleTypes";
import { BCPLUS_AUTHOR, BCPLUS_VERSION } from "@/system/Constants";
import { Role, roleName } from "@/system/Roles";
import { BCPNotifyPlayer, MemberNumberToName, SendBCPMessage } from "@/utils/Messaging";
import type Authority from "@/modules/Authority";
import type Logging from "@/modules/Logging";
import type DataSync from "@/modules/DataSync";
import type Core from "@/modules/Core";

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
        Icon: menuIcon,
        HoverText: "Manage who holds BC+ roles: BC Owner and Lover always follow your actual in-game "
            + "relationships and cannot be assigned. Co-Owner and Mistress are assigned on this screen. "
            + "Whitelist and Friend follow your BC lists directly.",
        PublicData: true,
        Reference: "roles",
        MenuString: "Roles",
    };

    override get Permissions(): PermissionDefinition[] {
        return [
            {
                id: "roles.assign",
                label: "Assign roles (and create custom roles)",
                defaultRole: Role.Owner,
                defaultSelf: true,
            },
            {
                id: "roles.revoke",
                label: "Remove roles (and delete custom roles)",
                defaultRole: Role.Owner,
                defaultSelf: true,
            },
        ];
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

    override get SupportsRemote(): boolean {
        return true;
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

    /** Display label for an assignable role key ("owners"/"mistresses"/custom id). */
    private roleKeyLabel(key: string): string {
        if (key === "owners") {
            return roleName(Role.Owner);
        }
        if (key === "mistresses") {
            return roleName(Role.Mistress);
        }
        return this.getCustomRole(key)?.name ?? "?";
    }

    /** The member list behind an assignable role key, or null when unknown. */
    private roleKeyList(key: string): number[] | null {
        if (key === "owners") {
            return this.manualList(Role.Owner);
        }
        if (key === "mistresses") {
            return this.manualList(Role.Mistress);
        }
        return this.getCustomRole(key)?.members ?? null;
    }

    override Load(): void {
        // Remote role management: validated HERE - the requester is never trusted
        this.addSyncListener("RoleCommand", (sender, content) => {
            const senderNumber = sender.MemberNumber;
            if (typeof senderNumber !== "number") {
                return;
            }
            const reject = (reason: string): void => {
                SendBCPMessage({ message: "RoleCommandResult", ok: false, reason }, senderNumber);
            };

            const hardcore = this.ModuleManager.getModule<Core>("core")?.hardcoreSenderBlock(senderNumber);
            if (hardcore) {
                reject(hardcore);
                return;
            }
            const { action, role, member } = content;
            if ((action !== "assign" && action !== "revoke") || typeof role !== "string"
                || typeof member !== "number" || !Number.isInteger(member) || member < 0) {
                reject("invalid command");
                return;
            }
            const list = this.roleKeyList(role);
            if (!list) {
                reject("unknown role");
                return;
            }
            const authority = this.ModuleManager.getModule<Authority>("authority");
            const permission = action === "assign" ? "roles.assign" : "roles.revoke";
            if (!authority?.hasPermission(senderNumber, permission)) {
                reject("no permission");
                return;
            }
            if (action === "assign") {
                if (member === Player.MemberNumber) {
                    reject("cannot assign you to your own roles");
                    return;
                }
                if (list.includes(member)) {
                    reject("already assigned");
                    return;
                }
                list.push(member);
            } else {
                const index = list.indexOf(member);
                if (index === -1) {
                    reject("not assigned");
                    return;
                }
                list.splice(index, 1);
            }

            const label = this.roleKeyLabel(role);
            const memberName = MemberNumberToName(member);
            const verb = action === "assign" ? "assigned" : "removed";
            const preposition = action === "assign" ? "to" : "from";
            BCPNotifyPlayer(`${sender.Name} (#${senderNumber}) ${verb} ${memberName} (#${member}) ${preposition} your ${label} role.`);
            this.ModuleManager.getModule<Logging>("logging")
                ?.log("role", `${sender.Name} (#${senderNumber}) ${verb} ${memberName} (#${member}) ${preposition} role "${label}"`);
            SendBCPMessage({ message: "RoleCommandResult", ok: true }, senderNumber);
            this.ModuleManager.getModule<DataSync>("data-sync")?.categorySync(this, senderNumber);
        });

        this.addSyncListener("RoleCommandResult", (sender, content) => {
            if (content.ok === false) {
                BCPNotifyPlayer(`${sender.Name} rejected the role change${typeof content.reason === "string" ? `: ${content.reason}` : "."}`);
            }
        });
    }
}
