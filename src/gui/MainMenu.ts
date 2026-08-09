import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { ButtonActionWidget, DrawInfoPanel } from "@/system/gui/Widgets";
import { ModuleSettingsScreen } from "@/gui/ModuleSettings";
import { ExportImportScreen } from "@/gui/ExportImportScreen";
import { BCPLUS_REPO, BCPLUS_VERSION } from "@/system/Constants";
import { ModuleInstance } from "@/system/module/ModuleInstance";
import type { GUI } from "@/modules/GUI";

export class MainMenu extends GUIScreen {

    get Title(): string {
        return "Main Menu";
    }

    protected buildPages(): GUIPage[] {
        return [new MainMenuPage(this)];
    }
}

class MainMenuPage extends GUIPage {

    private menuModules: ModuleInstance[] = [];

    get Config(): PageOptions {
        return {
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: "This is the BC+ main menu. Each button opens the settings for one BC+ module. "
                + "Modules marked as inactive are disabled and cannot be configured.",
        };
    }

    override async create(): Promise<void> {
        const remote = this.Character !== null && !this.Character.isPlayer();
        this.menuModules = this.Core.ModuleManager.Modules.filter(
            (m) => (remote ? m.SupportsRemote : m.HasGUI),
        );
    }

    render(): void {
        MainCanvas.textAlign = "end";
        const character = this.Character;
        if (character) {
            DrawText(`Player: ${character.Name} (#${character.MemberNumber}) | BC+ v${BCPLUS_VERSION}`, 1800, 125, "Black", "Gray");
        }
        const modeText = this.Core.Mode === "tandem"
            ? `BCX v${window.bcx?.version ?? "?"} found. Tandem Mode Enabled`
            : "BCX not found. Control Mode Enabled";
        DrawText(modeText, 1800, 160, "Black", "Gray");

        MainCanvas.textAlign = "left";
        let hovered: { title: string; text: string } | null = null;
        this.menuModules.forEach((module, i) => {
            const col = Math.floor(i / 6);
            const row = i % 6;
            const rect = { Top: 190 + 120 * row, Left: 150 + 430 * col, Height: 90, Width: 400 };
            this.addClickHandler(ButtonActionWidget(
                rect,
                {
                    Name: module.Config.MenuString || module.Config.Name,
                    Icon: module.Config.Icon || null,
                    Active: module.Config.Active,
                },
                () => {
                    const screen = module.SettingsScreen?.(this.Character)
                        ?? new ModuleSettingsScreen(module, this.Character);
                    this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(screen);
                },
            ));
            if (MouseIn(rect.Left, rect.Top, rect.Width, rect.Height)) {
                hovered = {
                    title: module.Config.MenuString || module.Config.Name,
                    text: module.Config.Active
                        ? (module.Config.HoverText || module.Config.Description)
                        : "Module is deactivated.",
                };
            }
        });

        // Hover descriptions render in a fixed panel at readable size instead
        // of BC's one-line tooltip
        if (hovered !== null) {
            DrawInfoPanel(
                (hovered as { title: string; text: string }).title,
                (hovered as { title: string; text: string }).text,
                { Left: 1080, Top: 220, Width: 780, Height: 460 },
            );
        }

        // Own menu only - the hub exports/imports the player's own data
        if (!this.Character || this.Character.isPlayer()) {
            this.addClickHandler(ButtonActionWidget(
                { Top: 700, Left: 1450, Height: 90, Width: 400 },
                { Name: "Export / Import", HoverText: "Back up or share your rules and curses as codes" },
                () => {
                    this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(
                        new ExportImportScreen(this.Screen.Module, this.Character),
                    );
                },
            ));
        }
        this.addClickHandler(ButtonActionWidget(
            { Top: 810, Left: 1450, Height: 90, Width: 400 },
            { Name: "View Changelog", HoverText: "Open the BC+ changelog on GitHub" },
            () => {
                window.open(`${BCPLUS_REPO}/blob/main/CHANGE-LOG.md`, "_blank");
            },
        ));
    }
}
