import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig, PermissionDefinition } from "@/system/module/ModuleTypes";
import { BCPLUS_AUTHOR, BCPLUS_VERSION } from "@/system/Constants";
import { Role } from "@/system/Roles";
import { GUIScreen } from "@/system/gui/GUIScreen";
import { RolesScreen } from "@/gui/RolesScreen";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";

/** Storage keys for the manually assigned role lists. */
export const MANUAL_ROLE_KEYS = {
    [Role.ClubOwner]: "clubOwners",
    [Role.Owner]: "owners",
    [Role.Lover]: "lovers",
    [Role.Mistress]: "mistresses",
} as const;

export type ManualRole = keyof typeof MANUAL_ROLE_KEYS;

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
        HoverText: "Manage who holds BC+ roles: Club Owner, Owner, Lover and Mistress are combined "
            + "from your BC relationships and the lists on this screen. Whitelist and Friend follow "
            + "your BC lists directly.",
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
            clubOwners: [],
            owners: [],
            lovers: [],
            mistresses: [],
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
    derivedList(role: ManualRole): number[] {
        switch (role) {
            case Role.Owner:
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
        for (const role of [Role.ClubOwner, Role.Owner, Role.Lover, Role.Mistress] as ManualRole[]) {
            if (this.manualList(role).includes(memberNumber) || this.derivedList(role).includes(memberNumber)) {
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
}
