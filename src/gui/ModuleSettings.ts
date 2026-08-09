import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { AnySetting } from "@/system/gui/Settings";
import { SendBCPMessage } from "@/utils/Messaging";
import type Authority from "@/modules/Authority";

const ROW_HEIGHT = 80;
const TOP = 220;
const LEFT = 150;
const PER_PAGE = 8;

/**
 * Auto-generated settings screen driven by a module's `Settings` declaration.
 * Works on the player's own settings directly, or on another character's via
 * validated SettingCommand messages (reading their synced mirror).
 */
export class ModuleSettingsScreen extends GUIScreen {

    get Title(): string {
        const base = this.Module.Config.MenuString || this.Module.Config.Name;
        return this.Remote ? `${base} - ${this.Character!.Nickname}` : base;
    }

    get Remote(): boolean {
        return this.Character !== null && !this.Character.isPlayer();
    }

    getValue(setting: AnySetting): unknown {
        if (this.Remote) {
            return this.Character!.BCPData?.[this.Module.Slug]?.[setting.name] ?? setting.default;
        }
        return this.Module.getSetting(setting.name);
    }

    setValue(setting: AnySetting, value: unknown): void {
        if (this.Remote) {
            SendBCPMessage({
                message: "SettingCommand",
                module: this.Module.Slug,
                name: setting.name,
                value,
            }, this.Character!.MemberNumber);
            // No optimistic write; the target's change-broadcast updates the mirror
            return;
        }
        this.Module.setSetting(setting.name, value);
    }

    canEdit(): boolean {
        const permission = this.Module.EditPermission;
        if (!this.Remote) {
            // Local editing honors the module's own permission too (e.g. the
            // Slave preset removes self-access to Authority)
            if (!permission) {
                return true;
            }
            const authority = this.Module.ModuleManager.getModule<Authority>("authority");
            return authority?.hasPermission(Player.MemberNumber ?? -1, permission) ?? true;
        }
        if (!permission) {
            return false;
        }
        const authority = this.Module.ModuleManager.getModule<Authority>("authority");
        return authority?.remoteHasPermission(this.Character!, permission) ?? false;
    }

    protected buildPages(): GUIPage[] {
        const settings = this.Module.Settings;
        const pages: GUIPage[] = [];
        for (let i = 0; i < settings.length; i += PER_PAGE) {
            pages.push(new SettingsPage(this, settings.slice(i, i + PER_PAGE)));
        }
        if (pages.length === 0) {
            pages.push(new SettingsPage(this, []));
        }
        return pages;
    }
}

class SettingsPage extends GUIPage {

    constructor(protected override readonly screen: ModuleSettingsScreen, private readonly settings: AnySetting[]) {
        super(screen);
    }

    get Config(): PageOptions {
        return {
            showTitle: true,
            showBack: true,
            showHelp: this.screen.Module.Config.HoverText !== "",
            helpText: this.screen.Module.Config.HoverText,
        };
    }

    render(): void {
        const screen = this.screen;
        const canEdit = screen.canEdit();

        if (screen.Remote && !canEdit) {
            DrawText("You do not have permission to change these settings; viewing only.", LEFT, 190, "Gray");
        }

        this.settings.forEach((setting, i) => {
            const y = TOP + i * ROW_HEIGHT;
            const active = canEdit && (setting.active?.() ?? true);

            switch (setting.type) {
                case "checkbox": {
                    const checked = screen.getValue(setting) as boolean;
                    DrawCheckbox(LEFT, y, 64, 64, setting.label, checked, !active);
                    this.addClickHandler(() => {
                        if (active && MouseIn(LEFT, y, 64, 64)) {
                            screen.setValue(setting, !checked);
                            if (!screen.Remote) {
                                setting.onSet?.(!checked as never, checked as never);
                            }
                        }
                    });
                    break;
                }
                case "option": {
                    const value = screen.getValue(setting) as string;
                    DrawText(setting.label, LEFT, y + 32, "Black");
                    MainCanvas.textAlign = "center";
                    DrawBackNextButton(LEFT + 700, y, 350, 64, value, active ? "White" : "#ddd", "", () => "", () => "", !active);
                    MainCanvas.textAlign = "left";
                    this.addClickHandler(() => {
                        if (!active || !MouseIn(LEFT + 700, y, 350, 64)) {
                            return;
                        }
                        const index = setting.options.indexOf(value);
                        const direction = MouseX < LEFT + 700 + 175 ? -1 : 1;
                        const next = setting.options[(index + direction + setting.options.length) % setting.options.length]!;
                        screen.setValue(setting, next);
                        if (!screen.Remote) {
                            setting.onSet?.(next as never, value as never);
                        }
                    });
                    break;
                }
                case "text": {
                    // Text settings are not yet rendered on module settings
                    // pages (only rule config pages support them so far)
                    DrawText(`${setting.label} (not editable here yet)`, LEFT, y + 32, "Gray");
                    break;
                }
            }
        });

        if (!screen.Remote) {
            screen.Module.SettingsFooter?.((handler) => this.addClickHandler(handler));
        }
    }
}
