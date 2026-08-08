import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig, PermissionDefinition } from "@/system/module/ModuleTypes";
import { BCPLUS_AUTHOR, BCPLUS_VERSION } from "@/system/Constants";
import { Role, RoleNames } from "@/system/Roles";
import { AnySetting } from "@/system/gui/Settings";
import { warn } from "@/system/Console";
import type Roles from "@/modules/Roles";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";

/**
 * Central permission checks. Modules register PermissionDefinitions
 * (collected by the ModuleManager); each becomes a configurable pair of
 * "lowest role allowed" and "can I do this to myself".
 */
export default class Authority extends ModuleInstance {

    private readonly registry = new Map<string, PermissionDefinition>();

    protected readonly SystemConfig: ModuleConfig = {
        Name: "Authority",
        Version: BCPLUS_VERSION,
        Author: BCPLUS_AUTHOR,
        Description: "Who is allowed to do what",
        Active: true,
        Icon: "Icons/Preference.png",
        HoverText: "Each entry controls one BC+ permission: the lowest role allowed to use it on you, "
            + "and whether you may use it on yourself. Roles are ordered BC Owner > Owner > Lover > "
            + "Mistress > Whitelist > Friend > Public.",
        PublicData: true,
        Reference: "authority",
        MenuString: "Authority",
    };

    override get Permissions(): PermissionDefinition[] {
        return [{
            id: "authority.edit",
            label: "Edit permission settings",
            defaultRole: Role.Owner,
            defaultSelf: true,
        }];
    }

    override get SupportsRemote(): boolean {
        return true;
    }

    override get EditPermission(): string | null {
        return "authority.edit";
    }

    /** @internal Called by the ModuleManager with every module's permission definitions. */
    registerPermissions(definitions: PermissionDefinition[]): void {
        for (const def of definitions) {
            if (this.registry.has(def.id)) {
                warn(`Permission ${def.id} registered twice, keeping the first definition`);
                continue;
            }
            this.registry.set(def.id, def);
        }
    }

    /** Settings are generated from the registered permissions. */
    override get Settings(): AnySetting[] {
        const settings: AnySetting[] = [];
        for (const def of this.registry.values()) {
            settings.push({
                type: "option",
                name: `${def.id}.role`,
                label: def.label,
                options: [...RoleNames],
                default: RoleNames[def.defaultRole]!,
                hoverText: "Lowest role that may do this to you",
            });
            settings.push({
                type: "checkbox",
                name: `${def.id}.self`,
                label: `... and I can do this to myself`,
                default: def.defaultSelf,
            });
        }
        return settings;
    }

    /**
     * Whether the given member may use the given permission on the player.
     * Unknown permissions and blacklisted members are always denied.
     */
    hasPermission(memberNumber: number, permissionId: string): boolean {
        const def = this.registry.get(permissionId);
        if (!def) {
            warn(`Checked unknown permission: ${permissionId}`);
            return false;
        }
        if (memberNumber === Player.MemberNumber) {
            return this.getSetting<boolean>(`${permissionId}.self`);
        }
        if (Player.BlackList.includes(memberNumber)) {
            return false;
        }
        const roles = this.ModuleManager.getModule<Roles>("roles");
        if (!roles) {
            return false;
        }
        const storedRole = RoleNames.indexOf(this.getSetting<string>(`${permissionId}.role`));
        const minRole = storedRole === -1 ? def.defaultRole : (storedRole as Role);
        return roles.highestRole(memberNumber) <= minRole;
    }

    /**
     * Best-effort preview of whether the PLAYER holds a permission on another
     * character, evaluated from that character's synced public data. The
     * target's own client remains the real authority - this only decides what
     * UI to offer. Whitelist/Friend standing is not visible remotely, so the
     * preview can under-estimate (never over-estimates roles it can see).
     */
    remoteHasPermission(character: BCPlusCharacter, permissionId: string): boolean {
        if (character.isPlayer()) {
            return this.hasPermission(Player.MemberNumber ?? -1, permissionId);
        }
        const def = this.registry.get(permissionId);
        if (!def) {
            return false;
        }
        const authorityData = character.BCPData?.["authority"];
        const storedName = authorityData?.[`${permissionId}.role`];
        const stored = typeof storedName === "string" ? RoleNames.indexOf(storedName) : -1;
        const minRole = stored === -1 ? def.defaultRole : (stored as Role);
        return this.viewerRoleToward(character) <= minRole;
    }

    /** The player's highest role toward another character, from their synced data and visible BC relationships. */
    private viewerRoleToward(character: BCPlusCharacter): Role {
        const me = Player.MemberNumber ?? -1;
        const rolesData = character.BCPData?.["roles"];
        const inList = (key: string): boolean => {
            const list = rolesData?.[key];
            return Array.isArray(list) && list.includes(me);
        };
        if (character.Character.Ownership?.MemberNumber === me) {
            return Role.BCOwner;
        }
        if (inList("owners")) {
            return Role.Owner;
        }
        if ((character.Character.Lovership ?? []).some((l) => l.MemberNumber === me)) {
            return Role.Lover;
        }
        if (inList("mistresses")) {
            return Role.Mistress;
        }
        return Role.Public;
    }
}
