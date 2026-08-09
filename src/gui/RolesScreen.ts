import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { Role, roleName } from "@/system/Roles";
import { MemberNumberToName } from "@/utils/Messaging";
import { UserSelectScreen } from "@/gui/UserSelectScreen";
import { MANUAL_ROLE_KEYS } from "@/modules/Roles";
import type { GUI } from "@/modules/GUI";
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

interface RoleRow {
    role: Role;
    member: number;
    name: string;
    /** Derived from BC relationships - shown, never removable here */
    derived: boolean;
}

export class RolesScreen extends GUIScreen {

    /** Which manual role the add-controls assign; survives page flips. */
    addRole: ManualRole = Role.Owner;

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
                + "relationships and cannot be changed here; Owner and Mistress are assigned with the "
                + "controls below. Whitelist and Friend follow your BC lists directly and are not listed. "
                + "Changing assignments requires the roles.manage permission.",
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

        // Header
        DrawText("Role", COL_ROLE, 225, "Gray");
        DrawText("ID", COL_ID, 225, "Gray");
        DrawText("Name", COL_NAME, 225, "Gray");
        DrawEmptyRect(COL_ROLE, 245, 1700 - COL_ROLE + 60, 0, "Gray");

        if (this.rows.length === 0) {
            DrawText("No role assignments yet.", COL_ROLE, ROW_TOP + 40, "Gray");
        }

        this.rows.forEach((row, i) => {
            const y = ROW_TOP + i * ROW_HEIGHT;
            DrawText(roleName(row.role), COL_ROLE, y + 40, "Black");
            DrawText(`#${row.member}`, COL_ID, y + 40, "Black");
            DrawText(row.name, COL_NAME, y + 40, "Black");
            if (row.derived) {
                DrawText("from BC", COL_ACTION - 40, y + 40, "Gray");
            } else if (canEdit) {
                MainCanvas.textAlign = "center";
                DrawButton(COL_ACTION, y, 60, 60, "X", "White", "", `Remove ${row.name} from ${roleName(row.role)}`);
                MainCanvas.textAlign = "left";
                this.addClickHandler(() => {
                    if (MouseIn(COL_ACTION, y, 60, 60)) {
                        const list = this.roles.manualList(row.role as ManualRole);
                        const index = list.indexOf(row.member);
                        if (index !== -1) {
                            list.splice(index, 1);
                        }
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
        DrawBackNextButton(260, 873, 280, 60, roleName(this.screen.addRole), "White", "", () => "", () => "");
        MainCanvas.textAlign = "left";
        this.addClickHandler(() => {
            if (MouseIn(260, 873, 280, 60)) {
                const manualRoles = Object.keys(MANUAL_ROLE_KEYS).map(Number) as ManualRole[];
                const index = manualRoles.indexOf(this.screen.addRole);
                this.screen.addRole = manualRoles[(index + 1) % manualRoles.length]!;
            }
        });

        ElementPosition(INPUT_ID, 720, 903, 280, 60);
        MainCanvas.textAlign = "center";
        DrawButton(900, 873, 140, 60, "Add", "White", "", `Assign as ${roleName(this.screen.addRole)}`);
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

    private openBrowser(): void {
        const role = this.screen.addRole;
        const excluded = [
            ...this.roles.manualList(role),
            ...this.roles.derivedList(role),
        ];
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
        const manual = this.roles.manualList(this.screen.addRole);
        if (!manual.includes(value) && !this.roles.derivedList(this.screen.addRole).includes(value)) {
            manual.push(value);
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