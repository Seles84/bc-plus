import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig, PermissionDefinition } from "@/system/module/ModuleTypes";
import { Role } from "@/system/Roles";
import { BCPLUS_AUTHOR, BCPLUS_SHORT_NAME, BCPLUS_VERSION } from "@/system/Constants";
import { GUIScreen } from "@/system/gui/GUIScreen";
import { MainMenu } from "@/gui/MainMenu";
import { BCPlusCharacter, getChatroomCharacter } from "@/utils/BCPlusCharacter";
import { debug } from "@/system/Console";
import appLogo from "@/images/icon90.png";

/**
 * Owns the in-club GUI: draws the BC+ button on the information sheet and
 * routes render/click/exit to the active BC+ subscreen.
 */
export class GUI extends ModuleInstance {

    static instance: GUI | null = null;

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

    setSubscreen(screen: GUIScreen | null): void {
        if (this.currentSubscreen) {
            void this.currentSubscreen.destroy();
        }
        this.currentSubscreen = screen;
        this.setSheetDOMVisible(screen === null);
        screen?.open();
    }

    closeSubscreen(): void {
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
            if (this.currentSubscreen) {
                this.currentSubscreen.render();
                return;
            }
            next(args);
            this.drawBCPlusButton();
        });

        this.addHook("InformationSheetClick", 10, (args, next) => {
            if (this.currentSubscreen) {
                this.currentSubscreen.click();
                return;
            }
            const character = this.getInformationSheetCharacter();
            // Only the player's own menu can be opened for now; remote
            // configuration needs the Authority module (Stage 5).
            if (character?.isPlayer() && MouseIn(...this.bcPlusButton)) {
                debug(`Opening BC+ main menu for ${character.toString()}`);
                this.setSubscreen(new MainMenu(this, character));
                return;
            }
            next(args);
        });

        this.addHook("InformationSheetExit", 10, (args, next) => {
            if (this.currentSubscreen) {
                this.currentSubscreen.exit();
                return;
            }
            next(args);
        });

        document.addEventListener("keydown", this.escapeHandler, true);
    }

    override Unload(): void {
        document.removeEventListener("keydown", this.escapeHandler, true);
        this.setSubscreen(null);
        GUI.instance = null;
        super.Unload();
    }

    private drawBCPlusButton(): void {
        const character = this.getInformationSheetCharacter();
        if (!character || !this.showButtonFor(character)) {
            return;
        }
        const isPlayer = character.isPlayer();
        DrawButton(
            ...this.bcPlusButton,
            "",
            "White",
            appLogo,
            isPlayer
                ? `${BCPLUS_SHORT_NAME} Settings`
                : `${character.Nickname} runs ${BCPLUS_SHORT_NAME} v${character.BCPVersion}`,
            !isPlayer,
        );
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
