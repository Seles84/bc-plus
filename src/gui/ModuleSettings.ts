import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { AnySetting } from "@/system/gui/Settings";

const ROW_HEIGHT = 80;
const TOP = 220;
const LEFT = 150;
const PER_PAGE = 8;

/** Auto-generated settings screen driven by a module's `Settings` declaration. */
export class ModuleSettingsScreen extends GUIScreen {

    get Title(): string {
        return this.Module.Config.MenuString || this.Module.Config.Name;
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

    constructor(screen: ModuleSettingsScreen, private readonly settings: AnySetting[]) {
        super(screen);
    }

    get Config(): PageOptions {
        return {
            showTitle: true,
            showBack: true,
            showHelp: this.Screen.Module.Config.HoverText !== "",
            helpText: this.Screen.Module.Config.HoverText,
        };
    }

    render(): void {
        const module = this.Screen.Module;

        this.settings.forEach((setting, i) => {
            const y = TOP + i * ROW_HEIGHT;
            const active = setting.active?.() ?? true;

            switch (setting.type) {
                case "checkbox": {
                    const checked = module.getSetting<boolean>(setting.name);
                    DrawCheckbox(LEFT, y, 64, 64, setting.label, checked, !active);
                    this.addClickHandler(() => {
                        if (active && MouseIn(LEFT, y, 64, 64)) {
                            module.setSetting(setting.name, !checked);
                            setting.onSet?.(!checked, checked);
                        }
                    });
                    break;
                }
                case "option": {
                    const value = module.getSetting<string>(setting.name);
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
                        module.setSetting(setting.name, next);
                        setting.onSet?.(next, value);
                    });
                    break;
                }
            }
        });
    }
}
