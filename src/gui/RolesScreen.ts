import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { Role, roleName } from "@/system/Roles";
import { MemberNumberToName, SendBCPMessage } from "@/utils/Messaging";
import { UserSelectScreen } from "@/gui/UserSelectScreen";
import { ButtonActionWidget } from "@/system/gui/Widgets";
import { modalInfo, modalPrompt } from "@/gui/Modal";
import { MANUAL_ROLE_KEYS } from "@/modules/Roles";
import type { GUI } from "@/modules/GUI";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";
import type { BCPlus } from "@/index";
import type { PermissionDefinition } from "@/system/module/ModuleTypes";
import type Authority from "@/modules/Authority";
import type Roles from "@/modules/Roles";
import type Rules from "@/modules/Rules";
import type Curses from "@/modules/Curses";
import type Commands from "@/modules/Commands";
import type { CustomRoleData, ManualRole } from "@/modules/Roles";

interface ScopeItem {
    id: string;
    label: string;
}

/** Items a permission can be limited to; null = the permission is not scopable. */
function scopeItemsFor(core: BCPlus, permissionId: string): ScopeItem[] | null {
    if (permissionId === "rules.edit") {
        const rules = core.ModuleManager.getModule<Rules>("rules");
        return rules?.Definitions.map((d) => ({ id: d.id, label: d.name })) ?? null;
    }
    if (permissionId === "curses.edit") {
        const curses = core.ModuleManager.getModule<Curses>("curses");
        return curses?.curseableGroups().map((g) => ({ id: g.Name as string, label: g.Description })) ?? null;
    }
    if (permissionId === "commands.use") {
        const commands = core.ModuleManager.getModule<Commands>("commands");
        return commands?.Definitions.map((d) => ({ id: d.id, label: d.name })) ?? null;
    }
    return null;
}

const INPUT_ID = "BCP_roleAddMember";
const PER_PAGE = 7;
const ROW_TOP = 260;
const ROW_HEIGHT = 70;
const COL_ROLE = 150;
const COL_ID = 480;
const COL_NAME = 720;
const COL_ACTION = 1500;

/** Either a built-in manual rank or a custom role id. */
type AssignableRole = ManualRole | string;

interface RoleRow {
    /** Built-in rank, or custom role id (string) */
    role: Role | string;
    member: number;
    name: string;
    /** Derived from BC relationships - shown, never removable here */
    derived: boolean;
    /** Placeholder row for a custom role without members */
    empty?: boolean;
}

/** The roles data being displayed: live local lists, or a synced remote mirror. */
interface RolesView {
    owners: number[];
    mistresses: number[];
    customRoles: Record<string, Pick<CustomRoleData, "name" | "members">>;
}

export class RolesScreen extends GUIScreen {

    /** Which role the add-controls assign; survives page flips. */
    addRole: AssignableRole = Role.Owner;

    get Title(): string {
        return this.Remote ? `Roles - ${this.Character!.Nickname}` : "Roles";
    }

    private get roles(): Roles {
        return this.Module as Roles;
    }

    /** Whether we are viewing (and remotely managing) another character's roles. */
    get Remote(): boolean {
        return this.Character !== null && !this.Character.isPlayer();
    }

    /** The role lists to display - own live data, or the target's synced mirror (sanitized). */
    viewData(): RolesView {
        if (!this.Remote) {
            return {
                owners: this.roles.manualList(Role.Owner),
                mistresses: this.roles.manualList(Role.Mistress),
                customRoles: this.roles.CustomRoles,
            };
        }
        const mirror = (this.Character!.BCPData?.["roles"] ?? {}) as Record<string, unknown>;
        const numbers = (v: unknown): number[] => (Array.isArray(v) ? v.filter((m): m is number => typeof m === "number") : []);
        const customRoles: RolesView["customRoles"] = {};
        const raw = mirror.customRoles;
        if (raw && typeof raw === "object") {
            for (const [id, role] of Object.entries(raw as Record<string, Partial<CustomRoleData>>)) {
                if (role && typeof role.name === "string") {
                    customRoles[id] = { name: role.name, members: numbers(role.members) };
                }
            }
        }
        return { owners: numbers(mirror.owners), mistresses: numbers(mirror.mistresses), customRoles };
    }

    canAssign(): boolean {
        const authority = this.Module.ModuleManager.getModule<Authority>("authority");
        if (this.Remote) {
            return authority?.remoteHasPermission(this.Character!, "roles.assign") ?? false;
        }
        return authority?.hasPermission(Player.MemberNumber ?? -1, "roles.assign") ?? false;
    }

    canRevoke(): boolean {
        const authority = this.Module.ModuleManager.getModule<Authority>("authority");
        if (this.Remote) {
            return authority?.remoteHasPermission(this.Character!, "roles.revoke") ?? false;
        }
        return authority?.hasPermission(Player.MemberNumber ?? -1, "roles.revoke") ?? false;
    }

    /** Built-in assignable ranks followed by custom role ids. */
    assignableRoles(): AssignableRole[] {
        return [
            ...(Object.keys(MANUAL_ROLE_KEYS).map(Number) as ManualRole[]),
            ...Object.keys(this.viewData().customRoles),
        ];
    }

    roleLabel(role: Role | string): string {
        return typeof role === "string"
            ? (this.viewData().customRoles[role]?.name ?? "?")
            : roleName(role);
    }

    buildRows(): RoleRow[] {
        const view = this.viewData();
        const bc = this.Remote ? this.Character!.Character : Player;
        const rows: RoleRow[] = [];

        if (bc.Ownership && typeof bc.Ownership.MemberNumber === "number") {
            rows.push({ role: Role.BCOwner, member: bc.Ownership.MemberNumber, name: bc.Ownership.Name, derived: true });
        }
        for (const member of view.owners) {
            rows.push({ role: Role.Owner, member, name: MemberNumberToName(member), derived: false });
        }
        for (const lover of bc.Lovership ?? []) {
            if (typeof lover.MemberNumber === "number") {
                rows.push({ role: Role.Lover, member: lover.MemberNumber, name: lover.Name, derived: true });
            }
        }
        for (const member of view.mistresses) {
            rows.push({ role: Role.Mistress, member, name: MemberNumberToName(member), derived: false });
        }
        for (const [id, role] of Object.entries(view.customRoles)) {
            if (role.members.length === 0) {
                rows.push({ role: id, member: -1, name: "(no members)", derived: false, empty: true });
            }
            for (const member of role.members) {
                rows.push({ role: id, member, name: MemberNumberToName(member), derived: false });
            }
        }
        return rows;
    }

    /** Wire key for an assignable role, as the RoleCommand handler expects it. */
    roleKey(role: AssignableRole): string {
        return typeof role === "string" ? role : MANUAL_ROLE_KEYS[role];
    }

    protected buildPages(): GUIPage[] {
        const rows = this.buildRows();
        const pages: GUIPage[] = [];
        for (let i = 0; i < Math.max(1, Math.ceil(rows.length / PER_PAGE)); i++) {
            pages.push(new RolesTablePage(this, rows.slice(i * PER_PAGE, (i + 1) * PER_PAGE)));
        }
        return pages;
    }
}

class RolesTablePage extends GUIPage {

    private removeListener: (() => void) | null = null;

    constructor(protected override readonly screen: RolesScreen, private readonly rows: RoleRow[]) {
        super(screen);
    }

    private get roles(): Roles {
        return this.screen.Module as Roles;
    }

    get Config(): PageOptions {
        return {
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: "All BC+ role assignments in one table. BC Owner and Lover follow the in-game "
                + "relationships; Owner and Mistress are ranks in the hierarchy; custom roles (create "
                + "them top right) are permission bundles that grant exactly what you configure - "
                + "click a custom role's name to set its grants. Whitelist and Friend follow the BC "
                + "lists and are not listed. Adding assignments requires roles.assign; removing them "
                + "requires roles.revoke. On someone else's roles, their client validates every change.",
        };
    }

    override async create(): Promise<void> {
        ElementCreateInput(INPUT_ID, "number", "", "9");
        const character = this.Character;
        if (character && !character.isPlayer()) {
            // Remote changes are not applied optimistically - the target's
            // auto-broadcast refreshes the mirror, and this rebuilds the table
            this.removeListener = this.Core.Events.on("characterSyncReceived", ({ memberNumber }) => {
                if (memberNumber === character.MemberNumber) {
                    this.screen.reopen();
                }
            });
        }
    }

    override async destroy(): Promise<void> {
        ElementRemove(INPUT_ID);
        this.removeListener?.();
        this.removeListener = null;
    }

    render(): void {
        const canAssign = this.screen.canAssign();
        const canRevoke = this.screen.canRevoke();

        DrawText("Role", COL_ROLE, 225, "Gray");
        DrawText("ID", COL_ID, 225, "Gray");
        DrawText("Name", COL_NAME, 225, "Gray");
        DrawEmptyRect(COL_ROLE, 245, 1700 - COL_ROLE + 60, 0, "Gray");

        if (canAssign && !this.screen.Remote) {
            MainCanvas.textAlign = "center";
            this.addClickHandler(ButtonActionWidget(
                { Left: 1520, Top: 150, Width: 280, Height: 60 },
                { Name: "Create role...", HoverText: "Create a custom role: a bundle of permission grants" },
                () => {
                    void modalPrompt("Name for the new role:", "", 30).then((name) => {
                        if (name !== null && name.trim().length > 0) {
                            if (this.roles.createCustomRole(name) === null) {
                                void modalInfo("Could not create the role (empty name or too many roles).");
                            }
                            this.screen.reopen();
                        }
                    });
                },
            ));
            MainCanvas.textAlign = "left";
        }

        if (this.rows.length === 0) {
            DrawText("No role assignments yet.", COL_ROLE, ROW_TOP + 40, "Gray");
        }

        this.rows.forEach((row, i) => {
            const y = ROW_TOP + i * ROW_HEIGHT;
            const isCustom = typeof row.role === "string";
            if (isCustom && !this.screen.Remote) {
                // Custom role names are clickable: they open the grants editor
                this.addClickHandler(ButtonActionWidget(
                    { Left: COL_ROLE - 10, Top: y, Width: 300, Height: 60 },
                    { Name: this.screen.roleLabel(row.role), HoverText: "Configure this role's permission grants" },
                    () => {
                        this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(
                            new CustomRoleScreen(this.roles, this.Character, row.role as string),
                        );
                    },
                ));
            } else {
                DrawText(this.screen.roleLabel(row.role), COL_ROLE, y + 40, "Black");
            }
            if (!row.empty) {
                DrawText(`#${row.member}`, COL_ID, y + 40, "Black");
            }
            DrawText(row.name, COL_NAME, y + 40, row.empty ? "Gray" : "Black");
            if (row.derived) {
                DrawText("from BC", COL_ACTION - 40, y + 40, "Gray");
            } else if (canRevoke && !row.empty) {
                MainCanvas.textAlign = "center";
                DrawButton(COL_ACTION, y, 60, 60, "X", "White", "", `Remove ${row.name} from ${this.screen.roleLabel(row.role)}`);
                MainCanvas.textAlign = "left";
                this.addClickHandler(() => {
                    if (MouseIn(COL_ACTION, y, 60, 60)) {
                        this.removeMember(row);
                        this.screen.reopen();
                    }
                });
            }
            DrawEmptyRect(COL_ROLE, y + ROW_HEIGHT - 4, 1700 - COL_ROLE + 60, 0, "#ddd");
        });

        if (!canAssign) {
            DrawText(
                canRevoke
                    ? "You may remove assignments but not add new ones."
                    : "You do not have permission to manage roles; viewing only.",
                COL_ROLE, 905, "Gray",
            );
            return;
        }

        // Add controls
        DrawText("Add:", COL_ROLE, 905, "Black");
        MainCanvas.textAlign = "center";
        DrawBackNextButton(260, 873, 280, 60, this.screen.roleLabel(this.screen.addRole), "White", "", () => "", () => "");
        MainCanvas.textAlign = "left";
        this.addClickHandler(() => {
            if (MouseIn(260, 873, 280, 60)) {
                const assignable = this.screen.assignableRoles();
                const index = assignable.findIndex((r) => r === this.screen.addRole);
                const direction = MouseX < 260 + 140 ? -1 : 1;
                this.screen.addRole = assignable[(index + direction + assignable.length) % assignable.length]!;
            }
        });

        ElementPosition(INPUT_ID, 720, 903, 280, 60);
        MainCanvas.textAlign = "center";
        DrawButton(900, 873, 140, 60, "Add", "White", "", `Assign as ${this.screen.roleLabel(this.screen.addRole)}`);
        DrawButton(1060, 873, 220, 60, "Browse...", "White", "", "Pick from room, friends and relationships");
        MainCanvas.textAlign = "left";
        this.addClickHandler(() => {
            if (MouseIn(900, 873, 140, 60)) {
                this.addFromInput();
            }
            if (MouseIn(1060, 873, 220, 60)) {
                this.openBrowser();
            }
        });
    }

    /** The displayed member list for a role; only mutate this in local mode. */
    private memberList(role: AssignableRole): number[] | null {
        const view = this.screen.viewData();
        if (typeof role === "string") {
            return view.customRoles[role]?.members ?? null;
        }
        return role === Role.Owner ? view.owners : view.mistresses;
    }

    private removeMember(row: RoleRow): void {
        if (this.screen.Remote) {
            // Their client validates roles.revoke; the ACK'd sync refreshes us
            SendBCPMessage({
                message: "RoleCommand",
                action: "revoke",
                role: this.screen.roleKey(row.role as AssignableRole),
                member: row.member,
            }, this.Character!.MemberNumber);
            return;
        }
        const list = this.memberList(row.role as AssignableRole);
        const index = list?.indexOf(row.member) ?? -1;
        if (list && index !== -1) {
            list.splice(index, 1);
        }
    }

    private openBrowser(): void {
        const excluded = this.memberList(this.screen.addRole) ?? [];
        this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(new UserSelectScreen(
            this.roles,
            this.Character,
            (memberNumber) => this.addMember(memberNumber),
            excluded,
        ));
    }

    /**
     * Adds a member to the selected role. No reopen here: the browse flow's
     * nav-stack return refreshes the table, and addFromInput reopens itself.
     */
    private addMember(value: number): void {
        if (!Number.isInteger(value) || value < 0) {
            return;
        }
        if (this.screen.Remote) {
            // Can't assign the target to their own roles; everything else
            // their client validates against roles.assign
            if (value === this.Character!.MemberNumber) {
                return;
            }
            SendBCPMessage({
                message: "RoleCommand",
                action: "assign",
                role: this.screen.roleKey(this.screen.addRole),
                member: value,
            }, this.Character!.MemberNumber);
            return;
        }
        if (value === Player.MemberNumber) {
            return;
        }
        const list = this.memberList(this.screen.addRole);
        if (list && !list.includes(value)) {
            list.push(value);
        }
    }

    private addFromInput(): void {
        const input = document.getElementById(INPUT_ID) as HTMLInputElement | null;
        this.addMember(Number.parseInt(input?.value ?? "", 10));
        if (input) {
            input.value = "";
        }
        this.screen.reopen();
    }
}

/** Grants editor for one custom role. */
export class CustomRoleScreen extends GUIScreen {

    constructor(module: Roles, character: BCPlusCharacter | null, private readonly roleId: string) {
        super(module, character);
    }

    get RoleId(): string {
        return this.roleId;
    }

    get Title(): string {
        const roles = this.Module as Roles;
        return `Role - ${roles.getCustomRole(this.roleId)?.name ?? "?"}`;
    }

    canDeleteRole(): boolean {
        const authority = this.Module.ModuleManager.getModule<Authority>("authority");
        return authority?.hasPermission(Player.MemberNumber ?? -1, "roles.revoke") ?? false;
    }

    protected buildPages(): GUIPage[] {
        return [new CustomRolePage(this)];
    }
}

class CustomRolePage extends GUIPage {

    constructor(protected override readonly screen: CustomRoleScreen) {
        super(screen);
    }

    private get roles(): Roles {
        return this.screen.Module as Roles;
    }

    get Config(): PageOptions {
        return {
            title: this.screen.Title,
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: "A custom role grants exactly the ticked permissions to its members, on top of "
                + "whatever their rank already allows. Grants are additive only - a custom role can "
                + "never take permissions away. Editing grants requires authority.edit; deleting the "
                + "role requires roles.revoke.",
        };
    }

    render(): void {
        const role = this.roles.getCustomRole(this.screen.RoleId);
        if (!role) {
            DrawText("This role no longer exists.", 150, 250, "Gray");
            return;
        }
        const authority = this.Core.ModuleManager.getModule<Authority>("authority");
        const canEditGrants = authority?.hasPermission(Player.MemberNumber ?? -1, "authority.edit") ?? false;
        const canManage = this.screen.canDeleteRole();

        DrawText(`Members: ${role.members.length} (assign on the Roles table)`, 150, 230, "Gray");
        DrawText("This role grants:", 150, 300, "Black");

        (authority?.PermissionDefs ?? []).forEach((def, i) => {
            const y = 340 + i * 70;
            const items = scopeItemsFor(this.Core, def.id);
            if (items) {
                // Scopable permission: Everything / N selected / None, opens the picker
                const full = role.grants.includes(def.id);
                const count = role.grants.filter((g) => g.startsWith(`${def.id}:`)).length;
                const status = full ? "Everything" : (count > 0 ? `${count} selected` : "None");
                DrawText(def.label, 150, y + 32, "Black");
                MainCanvas.textAlign = "center";
                DrawButton(1200, y, 300, 60, status, canEditGrants ? "White" : "#ddd", "", "Choose what this grant covers", !canEditGrants);
                MainCanvas.textAlign = "left";
                this.addClickHandler(() => {
                    if (canEditGrants && MouseIn(1200, y, 300, 60)) {
                        this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(
                            new GrantScopeScreen(this.roles, this.Character, this.screen.RoleId, def, items),
                        );
                    }
                });
                return;
            }
            const granted = role.grants.includes(def.id);
            DrawCheckbox(150, y, 64, 64, def.label, granted, !canEditGrants);
            this.addClickHandler(() => {
                if (canEditGrants && MouseIn(150, y, 64, 64)) {
                    this.roles.setCustomRoleGrant(this.screen.RoleId, def.id, !granted);
                }
            });
        });

        if (canManage) {
            MainCanvas.textAlign = "center";
            this.addClickHandler(ButtonActionWidget(
                { Left: 150, Top: 880, Width: 320, Height: 64 },
                { Name: "Delete this role", HoverText: "Removes the role and all its assignments" },
                () => {
                    this.roles.deleteCustomRole(this.screen.RoleId);
                    this.Screen.exit();
                },
            ));
            MainCanvas.textAlign = "left";
        }
    }
}

/** Picks what a scopable grant covers: everything, or specific items. */
class GrantScopeScreen extends GUIScreen {

    constructor(
        module: Roles,
        character: BCPlusCharacter | null,
        readonly roleId: string,
        readonly definition: PermissionDefinition,
        readonly items: ScopeItem[],
    ) {
        super(module, character);
    }

    get Title(): string {
        const roles = this.Module as Roles;
        return `${roles.getCustomRole(this.roleId)?.name ?? "?"} - ${this.definition.label}`;
    }

    protected buildPages(): GUIPage[] {
        const pages: GUIPage[] = [];
        const PER_SCOPE_PAGE = 8;
        for (let i = 0; i < Math.max(1, Math.ceil(this.items.length / PER_SCOPE_PAGE)); i++) {
            pages.push(new GrantScopePage(this, this.items.slice(i * PER_SCOPE_PAGE, (i + 1) * PER_SCOPE_PAGE)));
        }
        return pages;
    }
}

class GrantScopePage extends GUIPage {

    constructor(protected override readonly screen: GrantScopeScreen, private readonly items: ScopeItem[]) {
        super(screen);
    }

    private get roles(): Roles {
        return this.screen.Module as Roles;
    }

    get Config(): PageOptions {
        return {
            title: this.screen.Title,
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: "Choose what this role's grant covers: everything, or only the ticked items. "
                + "Members can then use the permission exactly on those items and nothing else.",
        };
    }

    render(): void {
        const role = this.roles.getCustomRole(this.screen.roleId);
        if (!role) {
            DrawText("This role no longer exists.", 150, 250, "Gray");
            return;
        }
        const authority = this.Core.ModuleManager.getModule<Authority>("authority");
        const canEdit = authority?.hasPermission(Player.MemberNumber ?? -1, "authority.edit") ?? false;
        const permissionId = this.screen.definition.id;
        const full = role.grants.includes(permissionId);

        DrawCheckbox(150, 210, 64, 64, "Grant for everything", full, !canEdit);
        this.addClickHandler(() => {
            if (canEdit && MouseIn(150, 210, 64, 64)) {
                this.roles.setCustomRoleGrant(this.screen.roleId, permissionId, !full);
            }
        });
        DrawEmptyRect(150, 295, 1610, 0, "Gray");

        this.items.forEach((item, i) => {
            const y = 320 + i * 70;
            const scoped = role.grants.includes(`${permissionId}:${item.id}`);
            DrawCheckbox(150, y, 64, 64, item.label, full || scoped, full || !canEdit);
            this.addClickHandler(() => {
                if (canEdit && !full && MouseIn(150, y, 64, 64)) {
                    this.roles.setCustomRoleGrant(this.screen.roleId, `${permissionId}:${item.id}`, !scoped);
                }
            });
        });
    }
}