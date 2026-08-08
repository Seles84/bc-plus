import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { Role, roleName } from "@/system/Roles";
import { MemberNumberToName } from "@/utils/Messaging";
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
        return ([Role.ClubOwner, Role.Owner, Role.Lover, Role.Mistress] as ManualRole[])
            .map((role) => new RolePage(this, role));
    }
}

class RolePage extends GUIPage {

    constructor(screen: RolesScreen, private readonly role: ManualRole) {
        super(screen);
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
        ElementCreateInput(INPUT_ID, "number", "", "9");
    }

    override async destroy(): Promise<void> {
        ElementRemove(INPUT_ID);
    }

    render(): void {
        const derived = this.roles.derivedList(this.role);
        const manual = this.roles.manualList(this.role);
        let row = 0;

        for (const member of derived.slice(0, MAX_ROWS)) {
            const y = ROW_TOP + row++ * ROW_HEIGHT;
            DrawText(`${MemberNumberToName(member)} (#${member}) - from your BC relationship`, LEFT, y + 30, "Gray");
        }

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
        MainCanvas.textAlign = "left";
        this.addClickHandler(() => {
            if (MouseIn(720, 845, 160, 60)) {
                this.addFromInput();
            }
        });
    }

    private addFromInput(): void {
        const input = document.getElementById(INPUT_ID) as HTMLInputElement | null;
        const value = Number.parseInt(input?.value ?? "", 10);
        if (!Number.isInteger(value) || value < 0 || value === Player.MemberNumber) {
            return;
        }
        const manual = this.roles.manualList(this.role);
        if (!manual.includes(value) && !this.roles.derivedList(this.role).includes(value)) {
            manual.push(value);
        }
        if (input) {
            input.value = "";
        }
    }
}
