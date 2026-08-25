import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig, PermissionDefinition } from "@/system/module/ModuleTypes";
import { Role } from "@/system/Roles";
import { BCPLUS_AUTHOR, BCPLUS_SHORT_NAME, BCPLUS_VERSION } from "@/system/Constants";
import { UIWindow } from "@/ui/Shell";
import { BCPlusCharacter, getChatroomCharacter } from "@/utils/BCPlusCharacter";
import { BCPNotifyPlayer } from "@/utils/Messaging";
import { debug } from "@/system/Console";
import type Authority from "@/modules/Authority";
import type Core from "@/modules/Core";
import type Welding from "@/modules/Welding";
import { describeWeldLine } from "@/modules/Welding";
import appLogo from "@/images/icon90.png";

/**
 * Owns the in-club GUI entry points: the BC+ button and weld line on the
 * information sheet, and the BC+ window (the Vue app in UIWindow) they open.
 * The window starts floating or maximized per the modal-mode preference.
 */
export class GUI extends ModuleInstance {

    private uiWindow: UIWindow | null = null;
    private bcPlusButton: [number, number, number, number] = [1815, 685, 90, 90];

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
        this.uiWindow ??= new UIWindow(this.Core);
        this.uiWindow.open(member);
    }

    /** Opens the own main menu, for /bcp menu. False when hardcore blocks it. */
    openModalMenu(): boolean {
        if (this.hardcoreSelfBlocked()) {
            return false;
        }
        this.openWindow();
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
            const result = next(args);
            if (!window.bcx?.inBcxSubscreen()) {
                this.drawBCPlusButton();
            }
            return result;
        });

        this.addHook("InformationSheetClick", 10, (args, next) => {
            const character = this.getInformationSheetCharacter();
            if (character && this.canOpenMenuFor(character) && MouseIn(...this.bcPlusButton)
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
    }

    override Unload(): void {
        if (this.hardcoreTimer !== null) {
            clearInterval(this.hardcoreTimer);
            this.hardcoreTimer = null;
        }
        this.uiWindow?.close();
        this.uiWindow = null;
        super.Unload();
    }

    private drawBCPlusButton(): void {
        const character = this.getInformationSheetCharacter();
        if (!character || character.BCPVersion === null) {
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

    private getInformationSheetCharacter(): BCPlusCharacter | null {
        const selection = InformationSheetSelection;
        if (!selection || typeof selection.MemberNumber !== "number") {
            return null;
        }
        return getChatroomCharacter(selection.MemberNumber);
    }
}
