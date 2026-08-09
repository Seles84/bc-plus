import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { Role, roleName } from "@/system/Roles";
import { MemberNumberToName } from "@/utils/Messaging";
import { UserSelectScreen } from "@/gui/UserSelectScreen";
import { ButtonActionWidget } from "@/system/gui/Widgets";
import { MANUAL_ROLE_KEYS } from "@/modules/Roles";
import type { GUI } from "@/modules/GUI";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";
import type Authority from "@/modules/Authority";
import type Roles from "@/modules/Roles";
import type { ManualRole } from "@/modules/Roles";

const INPUT_ID = "BCP_roleAddMember";
const PER_PAGE = 8;
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

export class RolesScreen extends GUIScreen {

    /** Which role the add-controls assign; survives page flips. */
    addRole: AssignableRole = Role.Owner;

    get Title(): string {
        return "Roles";
    }

    private get roles(): Roles {
        return this.Module as Roles;
    }

    canEdit(): boolean {
        const authority = this.Module.ModuleManager.getModule<Authority>("authority");
        return authority?.hasPermission(Player.MemberNumber ?? -1, "roles.manage") ?? false;
    }

    /** Built-in assignable ranks followed by custom role ids. */
    assignableRoles(): AssignableRole[] {
        return [
            ...(Object.keys(MANUAL_ROLE_KEYS).map(Number) as ManualRole[]),
            ...Object.keys(this.roles.CustomRoles),
        ];
    }

    roleLabel(role: Role | string): string {
        return typeof role === "string"
            ? (this.roles.getCustomRole(role)?.name ?? "?")
            : roleName(role);
    }

    buildRows(): RoleRow[] {
        const roles = this.roles;
        const rows: RoleRow[] = [];

        if (Player.Ownership && typeof Player.Ownership.MemberNumber === "number") {
            rows.push({ role: Role.BCOwner, member: Player.Ownership.MemberNumber, name: Player.Ownership.Name, derived: true });
        }
        for (const member of roles.manualList(Role.Owner)) {
            rows.push({ role: Role.Owner, member, name: MemberNumberToName(member), derived: false });
        }
        for (const lover of Player.Lovership ?? []) {
            if (typeof lover.MemberNumber === "number") {
                rows.push({ role: Role.Lover, member: lover.MemberNumber, name: lover.Name, derived: true });
            }
        }
        for (const member of roles.manualList(Role.Mistress)) {
            rows.push({ role: Role.Mistress, member, name: MemberNumberToName(member), derived: false });
        }
        for (const [id, role] of Object.entries(roles.CustomRoles)) {
            if (role.members.length === 0) {
                rows.push({ role: id, member: -1, name: "(no members)", derived: false, empty: true });
            }
            for (const member of role.members) {
                rows.push({ role: id, member, name: MemberNumberToName(member), derived: false });
            }
        }
        return rows;
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
            helpText: "All BC+ role assignments in one table. BC Owner and Lover follow your in-game "
                + "relationships; Owner and Mistress are ranks in the hierarchy; custom roles (create "
                + "them top right) are permission bundles that grant exactly what you configure - "
                + "click a custom role's name to set its grants. Whitelist and Friend follow your BC "
                + "lists and are not listed. Managing assignments requires roles.manage.",
        };
    }

    override async create(): Promise<void> {
        ElementCreateInput(INPUT_ID, "number", "", "9");
    }

    override async destroy(): Promise<void> {
        ElementRemove(INPUT_ID);
    }

    render(): void {
        const canEdit = this.screen.canEdit();

        DrawText("Role", COL_ROLE, 225, "Gray");
        DrawText("ID", COL_ID, 225, "Gray");
        DrawText("Name", COL_NAME, 225, "Gray");
        DrawEmptyRect(COL_ROLE, 245, 1700 - COL_ROLE + 60, 0, "Gray");

        if (canEdit) {
            MainCanvas.textAlign = "center";
            this.addClickHandler(ButtonActionWidget(
                { Left: 1520, Top: 150, Width: 280, Height: 60 },
                { Name: "Create role...", HoverText: "Create a custom role: a bundle of permission grants" },
                () => {
                    const name = window.prompt("Name for the new role:");
                    if (name !== null && name.trim().length > 0) {
                        if (this.roles.createCustomRole(name) === null) {
                            window.alert("Could not create the role (empty name or too many roles).");
                        }
                        this.screen.reopen();
                    }
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
            if (isCustom) {
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
            } else if (canEdit && !row.empty) {
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

        if (!canEdit) {
            DrawText("You do not have permission to manage roles; viewing only.", COL_ROLE, 905, "Gray");
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

    private memberList(role: AssignableRole): number[] | null {
        if (typeof role === "string") {
            return this.roles.getCustomRole(role)?.members ?? null;
        }
        return this.roles.manualList(role);
    }

    private removeMember(row: RoleRow): void {
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
        if (!Number.isInteger(value) || value < 0 || value === Player.MemberNumber) {
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

    canEditRoles(): boolean {
        const authority = this.Module.ModuleManager.getModule<Authority>("authority");
        return authority?.hasPermission(Player.MemberNumber ?? -1, "roles.manage") ?? false;
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
                + "role requires roles.manage.",
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
        const canManage = this.screen.canEditRoles();

        DrawText(`Members: ${role.members.length} (assign on the Roles table)`, 150, 230, "Gray");
        DrawText("This role grants:", 150, 300, "Black");

        (authority?.PermissionDefs ?? []).forEach((def, i) => {
            const y = 340 + i * 70;
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
                { Left: 150, Top: 900, Width: 320, Height: 64 },
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