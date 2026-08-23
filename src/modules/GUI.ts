import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig, PermissionDefinition } from "@/system/module/ModuleTypes";
import { Role } from "@/system/Roles";
import { BCPLUS_AUTHOR, BCPLUS_SHORT_NAME, BCPLUS_VERSION } from "@/system/Constants";
import { GUIScreen } from "@/system/gui/GUIScreen";
import { ModalHost } from "@/system/gui/ModalHost";
import { MainMenu } from "@/gui/MainMenu";
import { WelcomeScreen } from "@/gui/WelcomeScreen";
import { BCPlusCharacter, getChatroomCharacter } from "@/utils/BCPlusCharacter";
import { BCPNotifyPlayer } from "@/utils/Messaging";
import { debug } from "@/system/Console";
import type Authority from "@/modules/Authority";
import type Core from "@/modules/Core";
import type Welding from "@/modules/Welding";
import { describeWeldLine } from "@/modules/Welding";
import appLogo from "@/images/icon90.png";

/**
 * Owns the in-club GUI: draws the BC+ button on the information sheet and
 * routes render/click/exit to the active BC+ subscreen.
 */
export class GUI extends ModuleInstance {

    static instance: GUI | null = null;

    private modalHost: ModalHost | null = null;
    private currentSubscreen: GUIScreen | null = null;
    private bcPlusButton: [number, number, number, number] = [1815, 685, 90, 90];
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
        if (this.hardcoreSelfBlocked()) {
            return false;
        }
        const character = getChatroomCharacter(Player.MemberNumber ?? -1);
        if (!character) {
            return false;
        }
        this.openModal(new MainMenu(this, character));
        return true;
    }

    /** Hardcore option 1: the player's own BC+ refuses to open while bound. */
    private hardcoreSelfBlocked(): boolean {
        return this.ModuleManager.getModule<Core>("core")?.hardcoreSelfBlocked() === true;
    }

    /**
     * Why a remote character's BC+ may not be opened (or stay open) right
     * now, or null. The hardcore part is a courtesy: it reads the target's
     * broadcast effective flag so bound people see a locked door instead of
     * NACKs - the real wall is the target-side command validation.
     */
    private remoteViewBlockReason(character: BCPlusCharacter): string | null {
        if (character.BCPData?.["hardcore"]?.["others"] === true && !Player.CanInteract()) {
            return "your hands are bound";
        }
        const authority = this.ModuleManager.getModule<Authority>("authority");
        if (!(authority?.remoteHasPermission(character, "gui.view") ?? false)) {
            return "no permission to view";
        }
        return null;
    }

    /**
     * Live re-check of the open screen: getting tied with your own view open
     * must close it (or "open BC+ before the scene" would sidestep the
     * hardcore block), and a remote view closes when access is lost mid-look
     * (you got bound under their hardcore setting, or your view permission
     * was revoked).
     */
    private hardcoreSweep(): void {
        const screen = this.currentSubscreen;
        if (!screen) {
            return;
        }
        const character = screen.Character;
        const reason = !character || character.isPlayer()
            ? (this.hardcoreSelfBlocked() ? "your hands are bound" : null)
            : this.remoteViewBlockReason(character);
        if (reason === null) {
            return;
        }
        this.modalHost?.close();
        this.closeSubscreen();
        BCPNotifyPlayer(`BC+ closed - ${reason}.`);
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
        if (this.bcxInstalled()) {
            // Tandem: BCX owns its usual slot, sit directly left of it
            this.bcPlusButton = [1700, 685, 90, 90];
        } else {
            // Control: take the slot BCX would occupy. Like BCX, nudge BC's
            // next-page arrow (natively at y765, 10px into this slot) down.
            this.bcPlusButton = [1815, 685, 90, 90];
            this.patchFunction("InformationSheetRun", {
                "DrawButton(1815, 765, 90, 90,": "DrawButton(1815, 800, 90, 90,",
            });
            this.patchFunction("InformationSheetClick", {
                "MouseIn(1815, 765, 90, 90)": "MouseIn(1815, 800, 90, 90)",
            });
        }

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
        this.hardcoreTimer = setInterval(() => this.hardcoreSweep(), 2000);
    }

    private hardcoreTimer: ReturnType<typeof setInterval> | null = null;

    override Unload(): void {
        if (this.hardcoreTimer !== null) {
            clearInterval(this.hardcoreTimer);
            this.hardcoreTimer = null;
        }
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
                ? `${BCPLUS_SHORT_NAME} Settings${canOpen ? "" : " - your hands are bound"}`
                : `${character.Nickname} runs ${BCPLUS_SHORT_NAME} v${character.BCPVersion}`
                    + (canOpen ? "" : ` - ${this.remoteViewBlockReason(character) ?? "no permission to view"}`),
            !canOpen,
        );
        this.drawWeldLine(character);
    }

    /**
     * The optional "welded by" line on the information sheet, drawn like one
     * of BC's own lines in the next slot under the ownership block.
     */
    private drawWeldLine(character: BCPlusCharacter): void {
        const data = character.isPlayer()
            ? this.ModuleManager.getModule<Welding>("welding")?.Data
            : character.BCPData?.["welding"];
        const line = describeWeldLine(data);
        if (!line) {
            return;
        }
        const prevAlign = MainCanvas.textAlign;
        MainCanvas.textAlign = "left";
        DrawTextFit(line, 550, this.weldLineY(character.Character), 450, "Black", "Gray");
        MainCanvas.textAlign = prevAlign;
    }

    /**
     * The y of the free line slot under BC's ownership block - replicates the
     * currentY flow of InformationSheetRun (R131: spacing 55/75 from y 125),
     * since BC keeps no cursor we could read back.
     */
    private weldLineY(C: Character): number {
        const spacing = 55;
        let y = 125 + spacing; // Name
        if (C.Name !== CharacterNickname(C)) {
            y += spacing;
        }
        if (TitleGet(C) !== "None") {
            y += spacing;
        }
        if (C.MemberNumber != null) {
            y += spacing;
        }
        y += 75; // Pronouns line + large gap
        if ((C.IsPlayer() || C.IsOnline()) && C.Creation !== undefined) {
            y += spacing; // "Member for ..."
        }
        if (C.IsPlayer()) {
            y += spacing; // Money
        }
        y += 75; // large gap
        y += spacing; // Difficulty
        y += spacing; // "Collared by ..." (or "Unowned")
        if (C.IsOwned() && C.IsOwned() !== "ggts" && C.OwnedSinceMs() > 0) {
            y += spacing; // "for N day(s)"
        }
        return y;
    }

    /** Own menu opens unless hardcore blocks it; others' when they run BC+ and permit viewing. */
    private canOpenMenuFor(character: BCPlusCharacter): boolean {
        if (character.isPlayer()) {
            return !this.hardcoreSelfBlocked();
        }
        if (character.BCPVersion === null) {
            return false;
        }
        return this.remoteViewBlockReason(character) === null;
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
