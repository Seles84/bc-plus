import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig, PermissionDefinition } from "@/system/module/ModuleTypes";
import { Role } from "@/system/Roles";
import { BCPLUS_AUTHOR, BCPLUS_SHORT_NAME, BCPLUS_VERSION } from "@/system/Constants";
import { UIWindow } from "@/ui/Shell";
import { BCPlusCharacter, getChatroomCharacter } from "@/utils/BCPlusCharacter";
import { BCPNotifyPlayer, MemberNumberToName } from "@/utils/Messaging";
import { RemoteRuleAccess, discardPendingRuleEdits, pendingRuleEditCounts } from "@/system/rules/RuleAccess";
import { modalChoice } from "@/gui/Modal";
import type Rules from "@/modules/Rules";
import { debug } from "@/system/Console";
import type Authority from "@/modules/Authority";
import type Core from "@/modules/Core";
import type Welding from "@/modules/Welding";
import { describeWeldLine } from "@/modules/Welding";
import appLogo from "@/images/icon90.png";
import RoomsView from "@/ui/screens/RoomsView.vue";

/**
 * Owns the in-club GUI entry points: the BC+ button and weld line on the
 * information sheet, and the BC+ window (the Vue app in UIWindow) they open.
 * The window starts floating or maximized per the modal-mode preference.
 */
export class GUI extends ModuleInstance {

    private uiWindow: UIWindow | null = null;
    private cachedSlot: [number, number, number, number] | null = null;
    private cachedSlotAt = 0;

    /**
     * Known information-sheet button homes of other mods (all 90x90 on the
     * y685 row). When such a mod is loaded its rectangle counts as occupied,
     * whether or not it draws on this particular sheet - their draw
     * conditions vary per character, and a stable slot beats a "sometimes
     * free" one (#166). BCX (1815, 685) is handled via bcxInstalled().
     */
    private static readonly FOREIGN_BUTTONS: { mod: string; rect: [number, number, number, number] }[] = [
        { mod: "Littlish Club", rect: [1700, 685, 90, 90] },
        { mod: "ABCL", rect: [1590, 685, 90, 90] },
    ];

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

    /** Opens (or focuses) the BC+ window - own BC+, or another member's. */
    openWindow(member?: number): void {
        if (!this.uiWindow) {
            this.uiWindow = new UIWindow(this.Core);
            this.uiWindow.closeGuard = () => this.confirmPendingRuleEdits();
        }
        this.uiWindow.open(member);
    }

    /**
     * Window close guard: unsent batched rule edits would otherwise vanish
     * into the queue with the dom believing they took effect (the UI shows
     * them applied optimistically).
     */
    private async confirmPendingRuleEdits(): Promise<boolean> {
        for (const [member, count] of pendingRuleEditCounts()) {
            const name = MemberNumberToName(member);
            const character = getChatroomCharacter(member);
            const choice = await modalChoice(
                `You have ${count} unsent rule change${count === 1 ? "" : "s"} for ${name} (#${member}).`
                + `${character ? "" : "\nThey are no longer in this room, so the changes cannot be sent."}`,
                character ? ["Send", "Discard", "Stay"] : ["Discard", "Stay"],
            );
            if (choice === "Stay") {
                return false;
            }
            const rules = this.ModuleManager.getModule<Rules>("rules");
            if (choice === "Send" && character && rules) {
                new RemoteRuleAccess(rules, this.ModuleManager.getModule<Authority>("authority"), character).save();
            } else {
                discardPendingRuleEdits(member);
            }
        }
        return true;
    }

    /** Opens the own main menu, for /bcp menu. False when hardcore blocks it. */
    openModalMenu(): boolean {
        if (this.hardcoreSelfBlocked()) {
            return false;
        }
        this.openWindow();
        return true;
    }

    /**
     * Opens another member's BC+ menu by number (the /bcp menu <number>
     * path) - same gates as clicking the info-sheet button. Returns an
     * error to show, or null when the window opened.
     */
    openRemoteMenu(member: number): string | null {
        const character = getChatroomCharacter(member);
        if (!character) {
            return "they are not in this room";
        }
        if (character.isPlayer()) {
            return this.openModalMenu() ? null : "your hands are bound (hardcore mode)";
        }
        if (character.BCPVersion === null) {
            return "they do not run BC+";
        }
        const reason = this.remoteViewBlockReason(character);
        if (reason !== null) {
            return reason;
        }
        this.openWindow(member);
        return null;
    }

    /** Opens the own window directly on the Rooms screen (room-editor entry point). */
    openRoomsScreen(): boolean {
        if (this.hardcoreSelfBlocked()) {
            return false;
        }
        if (!this.uiWindow) {
            this.uiWindow = new UIWindow(this.Core);
            this.uiWindow.closeGuard = () => this.confirmPendingRuleEdits();
        }
        this.uiWindow.openScreen({ component: RoomsView, title: "Rooms" });
        return true;
    }

    /** Re-applies the light/dark fallback after the theme setting changed. */
    applyUiTheme(): void {
        this.uiWindow?.applyTheme();
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
     * Live re-check of the open window: getting tied with your own view open
     * must close it (or "open BC+ before the scene" would sidestep the
     * hardcore block), and a remote view closes when access is lost mid-look
     * (you got bound under their hardcore setting, or your view permission
     * was revoked).
     */
    private hardcoreSweep(): void {
        if (!this.uiWindow?.isOpen) {
            return;
        }
        const viewing = this.uiWindow.Viewing;
        const target = viewing !== null ? getChatroomCharacter(viewing) : null;
        const reason = viewing === null || target === null || target.isPlayer()
            ? (this.hardcoreSelfBlocked() ? "your hands are bound" : null)
            : this.remoteViewBlockReason(target);
        if (reason !== null) {
            this.uiWindow.close();
            BCPNotifyPlayer(`BC+ closed - ${reason}.`);
        }
    }

    private hardcoreTimer: ReturnType<typeof setInterval> | null = null;
    private floatButton: HTMLDivElement | null = null;

    /**
     * Creates or removes the optional floating BC+ button per the Core
     * setting - a draggable DOM overlay that opens the window without going
     * through the profile sheet. Position persists per member and device.
     */
    applyFloatingButton(): void {
        const enabled = this.ModuleManager.getModule<Core>("core")?.getSetting<boolean>("floatingButton") === true;
        if (!enabled) {
            this.floatButton?.remove();
            this.floatButton = null;
            return;
        }
        if (this.floatButton) {
            return;
        }
        const SIZE = 52;
        const key = `BCP_${Player.MemberNumber}_FloatButton`;
        const button = document.createElement("div");
        button.id = "BCPFloatButton";
        button.title = "BC+ (drag to move)";
        let x = window.innerWidth - SIZE - 16;
        let y = Math.round(window.innerHeight * 0.35);
        try {
            const saved = JSON.parse(localStorage.getItem(key) ?? "null") as { x?: number; y?: number } | null;
            if (typeof saved?.x === "number" && typeof saved?.y === "number") {
                x = saved.x;
                y = saved.y;
            }
        } catch {
            // Corrupt or blocked storage - keep the default spot
        }
        const clamp = (): void => {
            x = Math.min(Math.max(0, x), window.innerWidth - SIZE);
            y = Math.min(Math.max(0, y), window.innerHeight - SIZE);
            button.style.left = `${x}px`;
            button.style.top = `${y}px`;
        };
        Object.assign(button.style, {
            position: "fixed",
            width: `${SIZE}px`,
            height: `${SIZE}px`,
            zIndex: "9990",
            borderRadius: "50%",
            background: `#241c2e url(${JSON.stringify(appLogo)}) center / 78% no-repeat`,
            border: "2px solid #8469b6",
            boxShadow: "0 4px 14px rgba(0, 0, 0, 0.45)",
            cursor: "pointer",
            touchAction: "none",
            userSelect: "none",
        });
        clamp();
        let drag: { startX: number; startY: number; moved: boolean } | null = null;
        button.addEventListener("pointerdown", (event) => {
            drag = { startX: event.clientX - x, startY: event.clientY - y, moved: false };
            button.setPointerCapture(event.pointerId);
            event.preventDefault();
        });
        button.addEventListener("pointermove", (event) => {
            if (!drag) {
                return;
            }
            const nx = event.clientX - drag.startX;
            const ny = event.clientY - drag.startY;
            if (drag.moved || Math.abs(nx - x) + Math.abs(ny - y) > 5) {
                drag.moved = true;
                x = nx;
                y = ny;
                clamp();
            }
        });
        button.addEventListener("pointerup", () => {
            const wasDrag = drag?.moved === true;
            drag = null;
            if (wasDrag) {
                try {
                    localStorage.setItem(key, JSON.stringify({ x, y }));
                } catch {
                    // Blocked storage - the spot just won't persist
                }
            } else if (!this.openModalMenu()) {
                BCPNotifyPlayer("BC+ cannot open - your hands are bound.");
            }
        });
        window.addEventListener("resize", clamp);
        document.body.appendChild(button);
        this.floatButton = button;
    }

    override Load(): void {
        if (!this.bcxInstalled()) {
            // Control: we may take the slot BCX would occupy. Like BCX,
            // nudge BC's next-page arrow (natively at y765, 10px into that
            // slot) down. If BCX loads late it re-applies the same patch -
            // a harmless duplicate warning - and the slot moves off 1815
            // at draw time.
            this.patchFunction("InformationSheetRun", {
                "DrawButton(1815, 765, 90, 90,": "DrawButton(1815, 800, 90, 90,",
            });
            this.patchFunction("InformationSheetClick", {
                "MouseIn(1815, 765, 90, 90)": "MouseIn(1815, 800, 90, 90)",
            });
        }

        this.addHook("InformationSheetRun", 14, (args, next) => {
            // Measure where BC's left text column actually ends this frame
            // (see drawWeldLine); cleared before our own drawing so the weld
            // line never measures itself
            this.measuringSheet = true;
            this.sheetLeftMaxY = 0;
            let result;
            try {
                result = next(args);
            } finally {
                this.measuringSheet = false;
            }
            if (!window.bcx?.inBcxSubscreen()) {
                this.drawBCPlusButton();
            }
            return result;
        });

        // Passive observer for the measurement above - only active during
        // the sheet's own draw call, a no-op flag check otherwise
        this.addHook("DrawTextFit", 0, (args, next) => {
            if (this.measuringSheet && args[1] === 550
                && typeof args[2] === "number" && args[2] < 790) {
                this.sheetLeftMaxY = Math.max(this.sheetLeftMaxY, args[2]);
            }
            return next(args);
        });

        this.addHook("InformationSheetClick", 10, (args, next) => {
            const character = this.getInformationSheetCharacter();
            if (character && this.canOpenMenuFor(character) && MouseIn(...this.buttonSlot())
                && !window.bcx?.inBcxSubscreen()) {
                debug(`Opening the BC+ window for ${character.toString()}`);
                // Leave the sheet so the club stays visible behind the window
                InformationSheetExit();
                this.openWindow(character.isPlayer() ? undefined : character.MemberNumber);
                return;
            }
            next(args);
        });

        this.hardcoreTimer = setInterval(() => this.hardcoreSweep(), 2000);
        this.applyFloatingButton();
    }

    override Unload(): void {
        if (this.hardcoreTimer !== null) {
            clearInterval(this.hardcoreTimer);
            this.hardcoreTimer = null;
        }
        this.floatButton?.remove();
        this.floatButton = null;
        this.uiWindow?.close();
        this.uiWindow = null;
        super.Unload();
    }

    /**
     * The BC+ button's information-sheet slot, decided at draw time so a
     * late-loading BCX (load order is not ours to control) or another mod's
     * known home never ends up underneath us: first free candidate on the
     * y685 row, scanning right to left from BCX's slot.
     */
    private buttonSlot(): [number, number, number, number] {
        if (this.cachedSlot !== null && Date.now() - this.cachedSlotAt < 2000) {
            return this.cachedSlot;
        }
        const occupied: [number, number, number, number][] = [];
        if (this.bcxInstalled()) {
            occupied.push([1815, 685, 90, 90]);
        }
        for (const { mod, rect } of GUI.FOREIGN_BUTTONS) {
            if (this.SDK.modInstalled(mod)) {
                occupied.push(rect);
            }
        }
        let slot: [number, number, number, number] = [1355, 685, 90, 90];
        for (const x of [1815, 1700, 1585, 1470, 1355]) {
            const overlaps = occupied.some(([ox, oy, ow, oh]) =>
                x < ox + ow && ox < x + 90 && 685 < oy + oh && oy < 685 + 90);
            if (!overlaps) {
                slot = [x, 685, 90, 90];
                break;
            }
        }
        this.cachedSlot = slot;
        this.cachedSlotAt = Date.now();
        return slot;
    }

    private drawBCPlusButton(): void {
        const character = this.getInformationSheetCharacter();
        if (!character || character.BCPVersion === null) {
            return;
        }
        const canOpen = this.canOpenMenuFor(character);
        DrawButton(
            ...this.buttonSlot(),
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
     * The optional "welded by" line on the information sheet, drawn one line
     * (55px) under the LAST line BC actually drew in the left text column
     * this frame - measured via the DrawTextFit observer, never predicted.
     * Prediction history: replicating BC's conditional line-count overlapped
     * the ownership text whenever it missed by one line, and a fixed y910
     * hid under the own sheet's DOM "Allowed interactions" dropdown (DOM
     * renders above canvas). BC's block never reaches past ~770 before its
     * hard reset to y800, so the measured slot always clears both the
     * others-sheet text pair (800/855) and the own-sheet dropdown.
     */
    private measuringSheet = false;
    private sheetLeftMaxY = 0;

    private drawWeldLine(character: BCPlusCharacter): void {
        const data = character.isPlayer()
            ? this.ModuleManager.getModule<Welding>("welding")?.Data
            : character.BCPData?.["welding"];
        const line = describeWeldLine(data);
        if (!line) {
            return;
        }
        const y = this.sheetLeftMaxY >= 125 ? this.sheetLeftMaxY + 55 : 745;
        const prevAlign = MainCanvas.textAlign;
        MainCanvas.textAlign = "left";
        DrawTextFit(line, 550, y, 450, "Black", "Gray");
        MainCanvas.textAlign = prevAlign;
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

    private getInformationSheetCharacter(): BCPlusCharacter | null {
        const selection = InformationSheetSelection;
        if (!selection || typeof selection.MemberNumber !== "number") {
            return null;
        }
        return getChatroomCharacter(selection.MemberNumber);
    }
}
