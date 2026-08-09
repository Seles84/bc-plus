import { GUIPage, PageOptions } from "@/system/gui/GUIScreen";
import { ModuleSettingsScreen } from "@/gui/ModuleSettings";
import { RoleNames } from "@/system/Roles";
import { AnySetting } from "@/system/gui/Settings";
import { PermissionDefinition } from "@/system/module/ModuleTypes";
import type Authority from "@/modules/Authority";

const PER_PAGE = 9;
const ROW_TOP = 250;
const ROW_H = 75;
const COL_NAME = 150;
const COL_ROLE = 1000;
const COL_ROLE_W = 340;
const COL_SELF = 1520;

/**
 * Authority as a table: one row per permission - its name, the lowest role
 * allowed, and the self-access checkbox. Inherits the generic settings
 * screen's local/remote value handling and permission gating.
 */
export class AuthorityScreen extends ModuleSettingsScreen {

    protected override buildPages(): GUIPage[] {
        const authority = this.Module as Authority;
        const defs = authority.PermissionDefs;
        const pages: GUIPage[] = [];
        for (let i = 0; i < Math.max(1, Math.ceil(defs.length / PER_PAGE)); i++) {
            pages.push(new AuthorityTablePage(this, defs.slice(i * PER_PAGE, (i + 1) * PER_PAGE)));
        }
        return pages;
    }

    /** The generated setting declaration behind a data key (for getValue/setValue). */
    settingFor(name: string): AnySetting | undefined {
        return this.Module.Settings.find((s) => s.name === name);
    }
}

class AuthorityTablePage extends GUIPage {

    constructor(protected override readonly screen: AuthorityScreen, private readonly defs: PermissionDefinition[]) {
        super(screen);
    }

    get Config(): PageOptions {
        return {
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: this.screen.Module.Config.HoverText,
        };
    }

    render(): void {
        const screen = this.screen;
        const canEdit = screen.canEdit();

        DrawText("Permission", COL_NAME, 215, "Gray");
        DrawText("Lowest role allowed", COL_ROLE, 215, "Gray");
        DrawText("Self", COL_SELF, 215, "Gray");
        DrawEmptyRect(COL_NAME, 235, 1700 - COL_NAME + 60, 0, "Gray");

        this.defs.forEach((def, i) => {
            const y = ROW_TOP + i * ROW_H;
            const roleSetting = screen.settingFor(`${def.id}.role`);
            const selfSetting = screen.settingFor(`${def.id}.self`);
            if (!roleSetting || !selfSetting) {
                return;
            }

            DrawTextFit(def.label, COL_NAME, y + 32, COL_ROLE - COL_NAME - 40, "Black");

            const role = screen.getValue(roleSetting) as string;
            MainCanvas.textAlign = "center";
            DrawBackNextButton(COL_ROLE, y, COL_ROLE_W, 60, role, canEdit ? "White" : "#ddd", "", () => "", () => "", !canEdit);
            MainCanvas.textAlign = "left";
            this.addClickHandler(() => {
                if (canEdit && MouseIn(COL_ROLE, y, COL_ROLE_W, 60)) {
                    const index = RoleNames.indexOf(role);
                    const direction = MouseX < COL_ROLE + COL_ROLE_W / 2 ? -1 : 1;
                    screen.setValue(roleSetting, RoleNames[(index + direction + RoleNames.length) % RoleNames.length]!);
                }
            });

            const self = screen.getValue(selfSetting) as boolean;
            DrawCheckbox(COL_SELF, y, 60, 60, "", self, !canEdit);
            this.addClickHandler(() => {
                if (canEdit && MouseIn(COL_SELF, y, 60, 60)) {
                    screen.setValue(selfSetting, !self);
                }
            });

            DrawEmptyRect(COL_NAME, y + ROW_H - 8, 1700 - COL_NAME + 60, 0, "#ddd");
        });

        if (!canEdit) {
            DrawText("You do not have permission to change these settings; viewing only.", COL_NAME, 950, "Gray");
        }
    }
}
