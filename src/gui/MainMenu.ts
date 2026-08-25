import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { ButtonActionWidget, DrawInfoPanel } from "@/system/gui/Widgets";
import { ModuleSettingsScreen } from "@/gui/ModuleSettings";
import { ExportImportScreen } from "@/gui/ExportImportScreen";
import { BCPLUS_REPO, BCPLUS_VERSION } from "@/system/Constants";
import { BCPVersionCompare, parseBCPVersion } from "@/utils/Version";
import { ModuleInstance } from "@/system/module/ModuleInstance";
import type { GUI } from "@/modules/GUI";
import type Core from "@/modules/Core";

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
                + "Feature modules (Rules, Curses, Commands, Relationships, Log, Pet, ...) can be "
                + "switched on or off on the General page - a module that is off disappears from "
                + "this menu and stops doing anything until re-enabled.",
        };
    }

    override async create(): Promise<void> {
        const remote = this.Character !== null && !this.Character.isPlayer();
        // Own menu: switched-off modules are hidden entirely (re-enable on the
        // General page). Remote menus list what can be done to the other
        // person, so the local module state does not filter them.
        this.menuModules = this.Core.ModuleManager.Modules.filter(
            (m) => (remote ? m.SupportsRemote : m.HasGUI && m.Config.Active),
        );
    }

    render(): void {
        MainCanvas.textAlign = "end";
        const character = this.Character;
        if (character) {
            DrawText(`Player: ${character.Name} (#${character.MemberNumber})`, 1800, 125, "Black", "Gray");
        }
        const modeText = this.Core.Mode === "tandem"
            ? `BCX v${window.bcx?.version ?? "?"} found. Tandem Mode Enabled`
            : "BCX not found. Control Mode Enabled";
        DrawText(modeText, 1800, 160, "Black", "Gray");
        // The help box covers this area; skip the lines instead of clipping them
        if (!this.Screen.HelpVisible) {
            this.renderVersionInfo();
        }

        MainCanvas.textAlign = "left";
        // Remote menus act on the TARGET's modules - the viewer's own module
        // being switched off (e.g. the opt-in Pet) must not gray the button;
        // the target's client validates whether their side answers
        const remote = character !== null && !character.isPlayer();
        let hovered: { title: string; text: string } | null = null;
        this.menuModules.forEach((module, i) => {
            const col = Math.floor(i / 6);
            const row = i % 6;
            const rect = { Top: 190 + 120 * row, Left: 150 + 430 * col, Height: 90, Width: 400 };
            const usable = remote || module.Config.Active;
            this.addClickHandler(ButtonActionWidget(
                rect,
                {
                    Name: module.Config.MenuString || module.Config.Name,
                    Icon: module.Config.Icon || null,
                    Active: usable,
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
                    text: usable
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

    /**
     * Version block under the header: own version, the viewed character's
     * version on remote menus, and how the viewed one compares to the latest
     * release (omitted while the manifest has not been fetched).
     */
    private renderVersionInfo(): void {
        const character = this.Character;
        const remote = character !== null && !character.isPlayer();
        let y = 195;
        DrawText(`Your BC+ Version: ${BCPLUS_VERSION}`, 1800, y, "Black", "Gray");
        y += 35;
        let viewedVersion = BCPLUS_VERSION;
        if (remote) {
            viewedVersion = character.BCPVersion ?? "unknown";
            DrawText(`${character.Name}'s BC+ Version: ${viewedVersion}`, 1800, y, "Black", "Gray");
            y += 35;
        }
        const latest = this.Core.ModuleManager.getModule<Core>("core")?.getLatestVersion();
        const viewed = parseBCPVersion(viewedVersion);
        if (!latest || viewed === null) {
            return;
        }
        const parsedLatest = parseBCPVersion(latest);
        if (parsedLatest === null) {
            return;
        }
        if (BCPVersionCompare(viewed, parsedLatest) >= 0) {
            DrawText("This is the latest version", 1800, y, "#207020", "Gray");
        } else {
            DrawText(`${latest} is the latest version`, 1800, y, "#A00000", "Gray");
        }
    }
}
