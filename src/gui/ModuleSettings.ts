import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { AnySetting, TextSetting } from "@/system/gui/Settings";
import { SendBCPMessage } from "@/utils/Messaging";
import { ElementSetVisible } from "@/utils/BCUtils";
import type Authority from "@/modules/Authority";
import type DataSync from "@/modules/DataSync";

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

    /** Settings whose input the user actually typed in (guards stale commits). */
    private readonly dirty = new Set<string>();
    private removeListener: (() => void) | null = null;

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

    private inputId(name: string): string {
        return `BCP_modset_${name.replace(/[^A-Za-z0-9]/g, "_")}`;
    }

    /** Same lifecycle as rule config text settings: create, position, commit on change + destroy. */
    override async create(): Promise<void> {
        const screen = this.screen;
        // Private modules' settings are not in the public mirror - ask the
        // target for a fresh view; the response refreshes this screen
        if (screen.Remote && !screen.Module.Config.PublicData) {
            this.Core.ModuleManager.getModule<DataSync>("data-sync")
                ?.requestModuleSettings(screen.Module.Slug, screen.Character!.MemberNumber);
            this.removeListener = this.Core.Events.on("characterSyncReceived", ({ memberNumber }) => {
                if (memberNumber === screen.Character!.MemberNumber) {
                    screen.reopen();
                }
            });
        }
        for (const setting of this.settings) {
            if (setting.type !== "text") {
                continue;
            }
            const element = ElementCreateInput(
                this.inputId(setting.name), "text",
                String(this.screen.getValue(setting) ?? ""), String(setting.maxChars ?? 256),
            );
            // `input` (not `change`) marks user edits: a screen refresh must
            // never commit an input the user never touched, or a stale value
            // would overwrite the freshly arrived one
            element.addEventListener("input", () => this.dirty.add(setting.name));
            element.addEventListener("change", () => this.commitText(setting, element.value));
        }
    }

    override async destroy(): Promise<void> {
        this.removeListener?.();
        this.removeListener = null;
        for (const setting of this.settings) {
            if (setting.type !== "text") {
                continue;
            }
            const id = this.inputId(setting.name);
            const element = document.getElementById(id) as HTMLInputElement | null;
            if (element && this.dirty.has(setting.name)
                && element.value !== String(this.screen.getValue(setting) ?? "")) {
                this.commitText(setting, element.value);
            }
            ElementRemove(id);
        }
    }

    private commitText(setting: TextSetting, value: string): void {
        const prev = String(this.screen.getValue(setting) ?? "");
        if (value === prev) {
            return;
        }
        this.screen.setValue(setting, value);
        if (!this.screen.Remote) {
            setting.onSet?.(value, prev);
        }
    }

    render(): void {
        const screen = this.screen;
        const canEdit = screen.canEdit();

        if (screen.Remote && !canEdit) {
            DrawText(screen.Module.Config.PublicData
                ? "You do not have permission to change these settings; viewing only."
                : "These settings are only shared with people permitted to change them - values shown are defaults.",
            LEFT, 190, "Gray");
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
                    DrawText(setting.label, LEFT, y + 32, "Black");
                    const id = this.inputId(setting.name);
                    const element = document.getElementById(id) as HTMLInputElement | null;
                    if (element) {
                        element.disabled = !active;
                    }
                    // DOM inputs float above the canvas-drawn help box
                    ElementSetVisible(id, !this.screen.HelpVisible);
                    ElementPosition(id, 1250, y + 27, 750, 60);
                    break;
                }
            }
        });

        if (!screen.Remote) {
            screen.Module.SettingsFooter?.((handler) => this.addClickHandler(handler));
        }
    }
}
