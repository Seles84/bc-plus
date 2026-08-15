import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig, PermissionDefinition } from "@/system/module/ModuleTypes";
import { Role } from "@/system/Roles";
import { BCPLUS_AUTHOR, BCPLUS_SHORT_NAME, BCPLUS_VERSION } from "@/system/Constants";
import { GUIScreen } from "@/system/gui/GUIScreen";
import { ModalHost } from "@/system/gui/ModalHost";
import { MainMenu } from "@/gui/MainMenu";
import { WelcomeScreen } from "@/gui/WelcomeScreen";
import { BCPlusCharacter, getChatroomCharacter } from "@/utils/BCPlusCharacter";
import { debug } from "@/system/Console";
import type Authority from "@/modules/Authority";
import type Core from "@/modules/Core";
import appLogo from "@/images/icon90.png";

/**
 * Owns the in-club GUI: draws the BC+ button on the information sheet and
 * routes render/click/exit to the active BC+ subscreen.
 */
export class GUI extends ModuleInstance {

    static instance: GUI | null = null;

    private modalHost: ModalHost | null = null;
    private currentSubscreen: GUIScreen | null = null;
    private bcPlusButton: [number, number, number, number] = [1600, 800, 90, 90];
    private readonly escapeHandler = (event: KeyboardEvent): void => {
        if ((event.key === "Escape" || event.key === "Esc") && this.currentSubscreen && CurrentScreen === "InformationSheet") {
            this.currentSubscreen.exit();
            event.stopPropagation();
        }
    };

    protected readonly SystemConfig: ModuleConfig = {
        Name: "GUI",
        Version: BCPLUS_VERSION,
        Author: BCPLUS_AUTHOR,
        Description: "BC+ menus and screens",
        Active: true,
        Icon: "",
        HoverText: "",
        PublicData: false,
        Reference: "gui",
    };

    override get Permissions(): PermissionDefinition[] {
        return [{
            id: "gui.view",
            label: "View my BC+ settings",
            defaultRole: Role.Friend,
            defaultSelf: true,
        }];
    }

    get CurrentSubscreen(): GUIScreen | null {
        return this.currentSubscreen;
    }

    /** Whether the floating-window host is currently showing the GUI. */
    get ModalActive(): boolean {
        return this.modalHost?.Active === true;
    }

    /** @internal The host, for the element-positioning hooks. */
    get Modal(): ModalHost | null {
        return this.modalHost;
    }

    /** Whether the player opted into modal mode. */
    modalModeEnabled(): boolean {
        return this.ModuleManager.getModule<Core>("core")?.getSetting<boolean>("modalMode") === true;
    }

    /** Opens a screen in the floating window (modal mode). */
    openModal(screen: GUIScreen): void {
        this.modalHost ??= new ModalHost(this);
        this.setSubscreen(screen);
        this.modalHost.open();
    }

    /** Opens the main menu in the floating window, for /bcp menu. */
    openModalMenu(): boolean {
        const character = getChatroomCharacter(Player.MemberNumber ?? -1);
        if (!character) {
            return false;
        }
        this.openModal(new MainMenu(this, character));
        return true;
    }

    private screenStack: GUIScreen[] = [];

    /** Opens a screen as the new root, dropping any navigation history. */
    setSubscreen(screen: GUIScreen | null): void {
        if (this.currentSubscreen) {
            void this.currentSubscreen.destroy();
        }
        this.screenStack = [];
        this.currentSubscreen = screen;
        this.setSheetDOMVisible(screen === null);
        screen?.open();
    }

    /** Navigates deeper: the current screen is remembered and restored on back. */
    pushSubscreen(screen: GUIScreen): void {
        if (this.currentSubscreen) {
            void this.currentSubscreen.destroy();
            this.screenStack.push(this.currentSubscreen);
        }
        this.currentSubscreen = screen;
        this.setSheetDOMVisible(false);
        screen.open();
    }

    /** Steps back one screen; closes BC+ entirely when the history is empty. */
    backSubscreen(): void {
        if (this.currentSubscreen) {
            void this.currentSubscreen.destroy();
        }
        const previous = this.screenStack.pop() ?? null;
        this.currentSubscreen = previous;
        this.setSheetDOMVisible(previous === null);
        previous?.reopen();
    }

    closeSubscreen(): void {
        // Destroy the active screen so its page cleanup runs - skipping it
        // left DOM inputs (rule/punishment text fields) stranded on screen
        if (this.currentSubscreen) {
            void this.currentSubscreen.destroy();
        }
        this.screenStack = [];
        this.currentSubscreen = null;
        this.setSheetDOMVisible(true);
    }

    /**
     * BC builds parts of the information sheet in DOM (appended to document.body),
     * which stays visible over our canvas screens - hide it while a BC+ screen is open.
     */
    private setSheetDOMVisible(visible: boolean): void {
        for (const id of GUI.SHEET_DOM_ELEMENTS) {
            const element = document.getElementById(id);
            if (element) {
                element.style.visibility = visible ? "" : "hidden";
            }
        }
    }

    /** DOM element ids BC creates for the information sheet (extend as BC adds more). */
    private static readonly SHEET_DOM_ELEMENTS = [
        "AllowedInteractions-dropdown-container",
    ];

    override async Init(): Promise<void> {
        if (GUI.instance) {
            throw new Error("Duplicate GUI initialization");
        }
        GUI.instance = this;
    }

    override Load(): void {
        // Avoid overlapping BCX's information sheet button in tandem mode
        this.bcPlusButton = this.bcxInstalled() ? [1700, 685, 90, 90] : [1600, 800, 90, 90];

        this.addHook("InformationSheetRun", 14, (args, next) => {
            if (window.bcx?.inBcxSubscreen()) {
                return next(args);
            }
            // A modal-hosted subscreen renders in its own window, never here
            if (this.currentSubscreen && !this.ModalActive) {
                this.currentSubscreen.render();
                return;
            }
            next(args);
            this.drawBCPlusButton();
        });

        this.addHook("InformationSheetClick", 10, (args, next) => {
            if (this.currentSubscreen && !this.ModalActive) {
                this.currentSubscreen.click();
                return;
            }
            const character = this.getInformationSheetCharacter();
            if (character && this.canOpenMenuFor(character) && MouseIn(...this.bcPlusButton)) {
                debug(`Opening BC+ main menu for ${character.toString()}`);
                const core = this.ModuleManager.getModule("core") as { isFirstRun?: () => boolean } | undefined;
                const screen = character.isPlayer() && core?.isFirstRun?.()
                    ? new WelcomeScreen(this, character)
                    : new MainMenu(this, character);
                if (this.modalModeEnabled()) {
                    // Modal mode: leave the sheet so the club stays visible,
                    // then open the same menu in the floating window
                    InformationSheetExit();
                    this.openModal(screen);
                } else {
                    this.setSubscreen(screen);
                }
                return;
            }
            next(args);
        });

        this.addHook("InformationSheetExit", 10, (args, next) => {
            if (this.currentSubscreen && !this.ModalActive) {
                this.currentSubscreen.exit();
                return;
            }
            next(args);
        });

        // Modal mode: our DOM inputs (all BCP_-prefixed) must land on the
        // floating window's canvas, not BC's - BC computes against MainCanvas
        // offsets, which are wrong for a fixed-position overlay panel
        this.addHook("ElementPosition", 20, (args, next) => {
            const host = this.modalHost;
            if (!host?.Active || !host.swapped) {
                return next(args);
            }
            const [elementOrId, x, y, w, h] = args as unknown as [string | HTMLElement, number, number, number, number?];
            const element = typeof elementOrId === "string" ? document.getElementById(elementOrId) : elementOrId;
            if (!element || !element.id.startsWith("BCP_")) {
                return next(args);
            }
            host.positionElement(element, x, y, w, h ?? 60);
        });

        document.addEventListener("keydown", this.escapeHandler, true);
    }

    override Unload(): void {
        document.removeEventListener("keydown", this.escapeHandler, true);
        this.modalHost?.destroy();
        this.modalHost = null;
        this.setSubscreen(null);
        GUI.instance = null;
        super.Unload();
    }

    private drawBCPlusButton(): void {
        const character = this.getInformationSheetCharacter();
        if (!character || !this.showButtonFor(character)) {
            return;
        }
        const canOpen = this.canOpenMenuFor(character);
        DrawButton(
            ...this.bcPlusButton,
            "",
            "White",
            appLogo,
            character.isPlayer()
                ? `${BCPLUS_SHORT_NAME} Settings`
                : `${character.Nickname} runs ${BCPLUS_SHORT_NAME} v${character.BCPVersion}`
                    + (canOpen ? "" : " - no permission to view"),
            !canOpen,
        );
    }

    /** Own menu always opens; others' when they run BC+ and their settings permit viewing. */
    private canOpenMenuFor(character: BCPlusCharacter): boolean {
        if (character.isPlayer()) {
            return true;
        }
        if (character.BCPVersion === null) {
            return false;
        }
        const authority = this.ModuleManager.getModule<Authority>("authority");
        return authority?.remoteHasPermission(character, "gui.view") ?? false;
    }

    /** The BC+ button shows on your own sheet, and on others' once DataSync detects BC+ on them. */
    private showButtonFor(character: BCPlusCharacter): boolean {
        return character.BCPVersion !== null;
    }

    private getInformationSheetCharacter(): BCPlusCharacter | null {
        const selection = InformationSheetSelection;
        if (!selection || typeof selection.MemberNumber !== "number") {
            return null;
        }
        return getChatroomCharacter(selection.MemberNumber);
    }
}
