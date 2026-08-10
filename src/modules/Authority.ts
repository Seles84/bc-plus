import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig, PermissionDefinition } from "@/system/module/ModuleTypes";
import { BCPLUS_AUTHOR, BCPLUS_VERSION } from "@/system/Constants";
import { Role, RoleNames, roleFromName } from "@/system/Roles";
import { AnySetting } from "@/system/gui/Settings";
import { warn } from "@/system/Console";
import { AuthorityScreen } from "@/gui/AuthorityScreen";
import type { GUIScreen } from "@/system/gui/GUIScreen";
import type Roles from "@/modules/Roles";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";

/**
 * Whether a grant set covers a permission, honoring scoped entries
 * (`perm:scope`). Full grants cover every scope; without a queried scope,
 * any scoped grant still counts as access to the permission in general.
 */
function matchGrants(grants: Set<string>, permissionId: string, scope?: string): boolean {
    if (grants.has(permissionId)) {
        return true;
    }
    if (scope !== undefined) {
        return grants.has(`${permissionId}:${scope}`);
    }
    const prefix = `${permissionId}:`;
    for (const grant of grants) {
        if (grant.startsWith(prefix)) {
            return true;
        }
    }
    return false;
}

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
            + "and whether you may use it on yourself. Roles are ordered BC Owner > Co-Owner > Lover > "
            + "Mistress > Whitelist > Friend > Public. Ghosted and blacklisted members are always denied.",
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

    override get SettingsScreen(): ((character: BCPlusCharacter | null) => GUIScreen) | null {
        return (character) => new AuthorityScreen(this, character);
    }

    /** Every registered permission, for grant checklists and diagnostics. */
    get PermissionDefs(): PermissionDefinition[] {
        return [...this.registry.values()];
    }

    override Load(): void {
        // "Owner" was renamed to "Co-Owner" after 0.4.0 - rewrite stored values
        for (const [key, value] of Object.entries(this.Data)) {
            if (key.endsWith(".role") && value === "Owner") {
                this.Data[key] = "Co-Owner";
            }
        }
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
     * Unknown permissions and ghosted/blacklisted members are always denied.
     * @param scope - The specific object being touched (rule id, curse slot);
     *   scoped custom-role grants (`perm:scope`) only pass for their scope.
     *   Without a scope, any grant for the permission counts as access.
     */
    hasPermission(memberNumber: number, permissionId: string, scope?: string): boolean {
        const def = this.registry.get(permissionId);
        if (!def) {
            warn(`Checked unknown permission: ${permissionId}`);
            return false;
        }
        if (memberNumber === Player.MemberNumber) {
            return this.getSetting<boolean>(`${permissionId}.self`);
        }
        if (Player.BlackList.includes(memberNumber) || Player.GhostList.includes(memberNumber)) {
            return false;
        }
        const roles = this.ModuleManager.getModule<Roles>("roles");
        if (!roles) {
            return false;
        }
        const storedRole = roleFromName(this.getSetting<string>(`${permissionId}.role`));
        const minRole = storedRole ?? def.defaultRole;
        if (roles.highestRole(memberNumber) <= minRole) {
            return true;
        }
        // Custom roles grant additively on top of the hierarchy
        return matchGrants(roles.customGrantsOf(memberNumber), permissionId, scope);
    }

    /**
     * Best-effort preview of whether the PLAYER holds a permission on another
     * character, evaluated from that character's synced public data. The
     * target's own client remains the real authority - this only decides what
     * UI to offer. Whitelist/Friend standing is not visible remotely, so the
     * preview can under-estimate (never over-estimates roles it can see).
     */
    remoteHasPermission(character: BCPlusCharacter, permissionId: string, scope?: string): boolean {
        if (character.isPlayer()) {
            return this.hasPermission(Player.MemberNumber ?? -1, permissionId, scope);
        }
        const def = this.registry.get(permissionId);
        if (!def) {
            return false;
        }
        const authorityData = character.BCPData?.["authority"];
        const storedName = authorityData?.[`${permissionId}.role`];
        const stored = typeof storedName === "string" ? roleFromName(storedName) : null;
        const minRole = stored ?? def.defaultRole;
        if (this.viewerRoleToward(character) <= minRole) {
            return true;
        }
        // Custom-role grants from the target's synced data
        const me = Player.MemberNumber ?? -1;
        const customRoles = character.BCPData?.["roles"]?.["customRoles"];
        if (typeof customRoles === "object" && customRoles !== null) {
            const grants = new Set<string>();
            for (const role of Object.values(customRoles as Record<string, { members?: number[]; grants?: string[] }>)) {
                if (Array.isArray(role.members) && role.members.includes(me) && Array.isArray(role.grants)) {
                    role.grants.forEach((g) => grants.add(g));
                }
            }
            return matchGrants(grants, permissionId, scope);
        }
        return false;
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
