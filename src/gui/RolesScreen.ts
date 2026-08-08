import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { Role, roleName } from "@/system/Roles";
import { MemberNumberToName } from "@/utils/Messaging";
import { UserSelectScreen } from "@/gui/UserSelectScreen";
import type { GUI } from "@/modules/GUI";
import { MANUAL_ROLE_KEYS } from "@/modules/Roles";
import type Roles from "@/modules/Roles";
import type { ManualRole } from "@/modules/Roles";

const INPUT_ID = "BCP_roleAddMember";
const ROW_TOP = 220;
const ROW_HEIGHT = 70;
const LEFT = 150;
const MAX_ROWS = 7;

export class RolesScreen extends GUIScreen {

    get Title(): string {
        return "Roles";
    }

    protected buildPages(): GUIPage[] {
        return [Role.BCOwner, Role.Owner, Role.Lover, Role.Mistress]
            .map((role) => new RolePage(this, role));
    }
}

class RolePage extends GUIPage {

    /** BC Owner and Lover are derived from the game and have no manual management. */
    private readonly manual: boolean;

    constructor(screen: RolesScreen, private readonly role: Role) {
        super(screen);
        this.manual = role in MANUAL_ROLE_KEYS;
    }

    private get roles(): Roles {
        return this.Screen.Module as Roles;
    }

    get Config(): PageOptions {
        return {
            title: `Roles - ${roleName(this.role)}`,
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: this.Screen.Module.Config.HoverText,
        };
    }

    override async create(): Promise<void> {
        if (this.manual) {
            ElementCreateInput(INPUT_ID, "number", "", "9");
        }
    }

    override async destroy(): Promise<void> {
        if (this.manual) {
            ElementRemove(INPUT_ID);
        }
    }

    render(): void {
        const derived = this.roles.derivedList(this.role);
        let row = 0;

        for (const member of derived.slice(0, MAX_ROWS)) {
            const y = ROW_TOP + row++ * ROW_HEIGHT;
            DrawText(`${MemberNumberToName(member)} (#${member}) - from your BC relationship`, LEFT, y + 30, "Gray");
        }

        if (!this.manual) {
            const relationship = this.role === Role.BCOwner ? "ownership" : "loverships";
            if (derived.length === 0) {
                DrawText(`You have no ${roleName(this.role)}. This role follows your in-game ${relationship} automatically.`, LEFT, ROW_TOP + 30, "Gray");
            } else {
                DrawText(`This role follows your in-game ${relationship} and cannot be assigned.`, LEFT, ROW_TOP + (row + 1) * ROW_HEIGHT, "Gray");
            }
            return;
        }

        const manual = this.roles.manualList(this.role as ManualRole);
        for (const member of manual.slice(0, MAX_ROWS - derived.length)) {
            const y = ROW_TOP + row++ * ROW_HEIGHT;
            DrawText(`${MemberNumberToName(member)} (#${member})`, LEFT, y + 30, "Black");
            MainCanvas.textAlign = "center";
            DrawButton(1000, y, 60, 60, "X", "White", "", `Remove from ${roleName(this.role)}`);
            MainCanvas.textAlign = "left";
            this.addClickHandler(() => {
                if (MouseIn(1000, y, 60, 60)) {
                    const index = manual.indexOf(member);
                    if (index !== -1) {
                        manual.splice(index, 1);
                    }
                }
            });
        }

        if (manual.length === 0 && derived.length === 0) {
            DrawText(`Nobody is assigned as ${roleName(this.role)} yet.`, LEFT, ROW_TOP + 30, "Gray");
        }

        DrawText("Member Number:", LEFT, 880, "Black");
        ElementPosition(INPUT_ID, 560, 875, 250, 60);
        MainCanvas.textAlign = "center";
        DrawButton(720, 845, 160, 60, "Add", "White", "", `Assign as ${roleName(this.role)}`);
        DrawButton(920, 845, 240, 60, "Browse...", "White", "", "Pick from room, friends and relationships");
        MainCanvas.textAlign = "left";
        this.addClickHandler(() => {
            if (MouseIn(720, 845, 160, 60)) {
                this.addFromInput();
            }
            if (MouseIn(920, 845, 240, 60)) {
                this.openBrowser();
            }
        });
    }

    private openBrowser(): void {
        const excluded = [
            ...this.roles.manualList(this.role as ManualRole),
            ...this.roles.derivedList(this.role),
        ];
        this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(new UserSelectScreen(
            this.roles,
            this.Character,
            (memberNumber) => this.addMember(memberNumber),
            excluded,
        ));
    }

    private addMember(value: number): void {
        if (!Number.isInteger(value) || value < 0 || value === Player.MemberNumber) {
            return;
        }
        const manual = this.roles.manualList(this.role as ManualRole);
        if (!manual.includes(value) && !this.roles.derivedList(this.role).includes(value)) {
            manual.push(value);
        }
    }

    private addFromInput(): void {
        const input = document.getElementById(INPUT_ID) as HTMLInputElement | null;
        this.addMember(Number.parseInt(input?.value ?? "", 10));
        if (input) {
            input.value = "";
        }
    }
}
