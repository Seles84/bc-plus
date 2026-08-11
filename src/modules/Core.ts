import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig, PermissionDefinition, SettingsFooterRenderer } from "@/system/module/ModuleTypes";
import { BCPLUS_APP_NAME, BCPLUS_AUTHOR, BCPLUS_REPO, BCPLUS_VERSION, BCPLUS_WEBSITE } from "@/system/Constants";
import { log, warn } from "@/system/Console";
import { InfoBeep } from "@/utils/BCUtils";
import { BCPVersionCompare, parseBCPVersion } from "@/utils/Version";
import { AnySetting } from "@/system/gui/Settings";
import { modalConfirm } from "@/gui/Modal";
import { BCPNotifyPlayer } from "@/utils/Messaging";
import { getChatroomCharacter } from "@/utils/BCPlusCharacter";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";
import appLogo from "@/images/icon90.png";
import { Role, RoleNames } from "@/system/Roles";
import type Authority from "@/modules/Authority";

export type BCPPreset = "Dominant" | "Switch" | "Submissive" | "Slave";
export const PRESETS: readonly BCPPreset[] = ["Dominant", "Switch", "Submissive", "Slave"];

/** Permissions the Slave preset removes self-access to. */
const SLAVE_SELF_LOCKED = ["rules.edit", "curses.edit", "authority.edit", "roles.assign", "roles.revoke", "relationships.edit", "log.delete", "core.modules"];

/**
 * Core housekeeping module: run preset, update notifications and, in tandem
 * mode, the BCX connection.
 */
export default class Core extends ModuleInstance {

    protected readonly SystemConfig: ModuleConfig = {
        Name: "Core",
        Version: BCPLUS_VERSION,
        Author: BCPLUS_AUTHOR,
        Description: "BC+ core housekeeping",
        Active: true,
        Icon: "Icons/General.png",
        HoverText: "General BC+ settings: notifications and core behavior.",
        PublicData: false,
        Reference: "core",
        MenuString: "General",
    };

    override get Defaults(): Record<string, unknown> {
        return {
            ...super.Defaults,
            firstRun: true,
            presetLocked: false,
        };
    }

    override get Permissions(): PermissionDefinition[] {
        return [{
            id: "core.modules",
            label: "Switch BC+ modules on or off",
            defaultRole: Role.Owner,
            defaultSelf: true,
        }];
    }

    /** Once a preset has been explicitly chosen, it is locked until a factory reset. */
    isPresetLocked(): boolean {
        return this.Data.presetLocked === true;
    }

    override get Settings(): AnySetting[] {
        return [
            {
                type: "option",
                name: "preset",
                label: "Play preset",
                hoverText: "Dominant: BC+ rules, curses and logging never apply to you and permissions start closed. "
                    + "Switch/Submissive: everything available with sensible permission defaults. "
                    + "Slave: locks you out of changing your own rules, curses, permissions, roles and relationships. "
                    + "Once chosen, the preset is locked - only a factory reset clears it.",
                options: [...PRESETS],
                default: "Switch",
                active: () => !this.isPresetLocked(),
                onSet: (value, prev) => void this.onPresetChanged(value as BCPPreset, prev as BCPPreset),
            },
            {
                type: "checkbox",
                name: "updateNotify",
                label: "Notify me in-club about BC+ updates",
                hoverText: "Beeps once after BC+ updated, and once per session when a newer "
                    + "version is available (reload the club to get it).",
                default: true,
            },
            {
                type: "checkbox",
                name: "roomIcons",
                label: "Show the BC+ icon above BC+ users in the room",
                hoverText: "Draws the BC+ logo next to BC's status icons above every character "
                    + "running BC+ (including you). Hovering it shows their BC+ version; a grayed "
                    + "icon means their permissions give you no access.",
                default: true,
            },
            ...this.moduleToggleSettings(),
        ];
    }

    /** One on/off checkbox per disableable feature module. */
    private moduleToggleSettings(): AnySetting[] {
        return this.ModuleManager.Modules.filter((m) => m.CanDisable).map((m) => ({
            type: "checkbox" as const,
            name: `module.${m.Slug}`,
            label: `${m.Config.MenuString || m.Config.Name} module enabled`,
            default: true,
            active: () => this.canManageModules(),
            onSet: (value: boolean) => this.applyModuleEnabled(m.Slug, value),
        }));
    }

    /** Whether the local player may switch modules (core.modules permission). */
    canManageModules(): boolean {
        const authority = this.ModuleManager.getModule<Authority>("authority");
        return authority?.hasPermission(Player.MemberNumber ?? -1, "core.modules") ?? false;
    }

    /** Whether the player has this feature module switched on. */
    isModuleEnabled(slug: string): boolean {
        return this.getSetting<boolean>(`module.${slug}`) !== false;
    }

    /** Live-applies a toggle: unload stops the module's hooks/listeners immediately. */
    private applyModuleEnabled(slug: string, enabled: boolean): void {
        const module = this.ModuleManager.getModule(slug);
        if (!module?.CanDisable) {
            return;
        }
        module.Config.Active = enabled;
        if (enabled) {
            module.Load();
            this.Events.emit("moduleLoaded", { slug });
        } else {
            module.Unload();
            this.Events.emit("moduleUnloaded", { slug });
        }
        BCPNotifyPlayer(`The ${module.Config.MenuString || module.Config.Name} module is now ${enabled ? "enabled" : "disabled"}.`);
    }

    /** The player's current preset. */
    getPreset(): BCPPreset {
        const value = this.getSetting<string>("preset");
        return (PRESETS as readonly string[]).includes(value) ? value as BCPPreset : "Switch";
    }

    /** While in the future, the reset button is armed and a second click wipes. */
    private resetArmedUntil = 0;

    /** Two-step "Reset BC+" button: arm on first click, wipe on the second within 3s. */
    override get SettingsFooter(): SettingsFooterRenderer | null {
        return (addClickHandler) => {
            const armed = Date.now() < this.resetArmedUntil;
            const prevAlign = MainCanvas.textAlign;
            MainCanvas.textAlign = "center";
            DrawButton(
                150, 880, 340, 70,
                armed ? "Confirm reset" : "Reset BC+",
                armed ? "#ff5252" : "#c94f4f",
                "",
                armed
                    ? "Click again to wipe ALL BC+ data and reload"
                    : "Factory reset - wipes every BC+ setting, rule, curse, role and log entry",
            );
            MainCanvas.textAlign = prevAlign;
            addClickHandler(() => {
                if (!MouseIn(150, 880, 340, 70)) {
                    return;
                }
                if (Date.now() < this.resetArmedUntil) {
                    this.resetArmedUntil = 0;
                    void this.Storage.wipeAllData(false).then((wiped) => {
                        if (wiped) {
                            BCPNotifyPlayer("BC+ has been reset. Reloading...");
                            setTimeout(() => window.location.reload(), 1500);
                        }
                    });
                } else {
                    this.resetArmedUntil = Date.now() + 3000;
                }
            });
        };
    }

    /** Whether the first-run welcome has not been completed yet. */
    isFirstRun(): boolean {
        return this.Data.firstRun === true;
    }

    completeFirstRun(): void {
        this.Data.firstRun = false;
    }

    /**
     * Applies a preset choice with full side effects (used by the welcome
     * screen); resolves with whether the choice was confirmed and applied.
     */
    async choosePreset(value: BCPPreset): Promise<boolean> {
        if (this.isPresetLocked()) {
            return false;
        }
        const prev = this.getPreset();
        this.setSetting("preset", value);
        return this.onPresetChanged(value, prev);
    }

    private async onPresetChanged(value: BCPPreset, prev: BCPPreset): Promise<boolean> {
        // Defense in depth: the UI disables the option while locked, but no
        // path may change a locked preset short of a factory reset
        if (this.isPresetLocked()) {
            this.setSetting("preset", prev);
            return false;
        }
        const warning = value === "Slave"
            ? "\n\nSlave removes your OWN access to change your rules, curses, permissions, roles and "
            + "relationships, and to clear your log - only people your permissions allow (e.g. your Owner) can."
            : "";
        const confirmed = await modalConfirm(
            `Set your preset to ${value}?\nThis configures your permissions to match and locks the preset - `
            + `only a factory reset clears it.${warning}`,
            value === "Slave",
        );
        if (!confirmed) {
            this.setSetting("preset", prev);
            return false;
        }
        this.applyPresetProfile(value);
        if (value === "Slave") {
            BCPNotifyPlayer("Slave preset applied: your rules, curses, permissions, roles, relationships and log are in others' hands.");
        } else if (value === "Dominant") {
            BCPNotifyPlayer("Dominant preset: BC+ rules, curses and logging will not apply to you, and others get no access by default.");
        } else {
            BCPNotifyPlayer(`${value} preset applied.`);
        }
        this.Data.presetLocked = true;
        (this.ModuleManager.getModule("rules") as { applyPreset?: () => void } | undefined)?.applyPreset?.();
        return true;
    }

    /**
     * Sets every permission's role threshold and self flag to match the preset:
     * - Dominant: others get nothing (BC Owner threshold everywhere), full self-access
     * - Switch: the registry defaults (the balanced middle)
     * - Submissive: defaults, plus anyone may view (gui.view -> Public)
     * - Slave: like Submissive, but self-access to rules/curses/permissions/
     *   roles/log-clearing is removed
     */
    private applyPresetProfile(preset: BCPPreset): void {
        const authority = this.ModuleManager.getModule<Authority>("authority");
        if (!authority) {
            return;
        }
        for (const def of authority.PermissionDefs) {
            let role: Role = def.defaultRole;
            let self = def.defaultSelf;
            if (preset === "Dominant") {
                role = Role.BCOwner;
                self = true;
            } else if ((preset === "Submissive" || preset === "Slave") && def.id === "gui.view") {
                role = Role.Public;
            }
            if (preset === "Slave" && SLAVE_SELF_LOCKED.includes(def.id)) {
                self = false;
            }
            authority.setSetting(`${def.id}.role`, RoleNames[role]!);
            authority.setSetting(`${def.id}.self`, self);
        }
    }

    /** Latest released version per the website's version manifest; null until fetched. */
    private latestVersion: string | null = null;

    getLatestVersion(): string | null {
        return this.latestVersion;
    }

    private async fetchLatestVersion(): Promise<void> {
        try {
            const response = await fetch(`${BCPLUS_WEBSITE}/version.json`, { cache: "no-store" });
            if (!response.ok) {
                return;
            }
            const data = await response.json() as { version?: unknown };
            if (typeof data.version === "string" && parseBCPVersion(data.version) !== null) {
                this.latestVersion = data.version;
                this.notifyIfOutdated();
            }
        } catch {
            // Offline or the manifest is not deployed yet - the menu just
            // omits the latest-version line
        }
    }

    /** Beeps once when a newer release than the running build is available. */
    private notifyIfOutdated(): void {
        const latest = this.latestVersion !== null ? parseBCPVersion(this.latestVersion) : null;
        const current = parseBCPVersion(BCPLUS_VERSION);
        if (latest === null || current === null) {
            return;
        }
        if (BCPVersionCompare(latest, current) > 0 && this.getSetting<boolean>("updateNotify")) {
            InfoBeep(`${BCPLUS_APP_NAME} v${this.latestVersion} is available - reload the club to update!`, 8000);
        }
    }

    /** DEV builds only: fakes the latest-version manifest; null re-fetches the real one. */
    devSetLatestVersion(version: string | null): void {
        if (!BCP_DEV_ENV) {
            return;
        }
        this.latestVersion = version;
        if (version === null) {
            void this.fetchLatestVersion();
        } else {
            this.notifyIfOutdated();
        }
    }

    override Load(): void {
        this.checkForUpdate();
        void this.fetchLatestVersion();
        this.installRoomIcon();
        const mode = this.BCMode === "tandem"
            ? `tandem with BCX v${window.bcx?.version ?? "?"}`
            : "standalone";
        if (this.isFirstRun()) {
            InfoBeep(`Welcome to ${BCPLUS_APP_NAME}! Open your character profile and click the BC+ button to get set up.`, 10_000);
        } else {
            InfoBeep(`${BCPLUS_APP_NAME} v${BCPLUS_VERSION} Ready! (${mode})`);
        }
        log(`Ready! Running ${mode}.`);

        // BCX rule triggers are recorded by the Logging module in tandem mode
    }

    /** Per-member access preview for the room icon, refreshed at most once a second. */
    private readonly roomIconAccess = new Map<number, { access: boolean; until: number }>();

    /**
     * BC+ logo above every BC+ user's head, next to BC's own status icons.
     * BC calls the hooked function per character per frame (character view,
     * and the map view for the character under the cursor). X slot 430 sits
     * right of BC's last slot (admin, 390) and of WCE/BCX's icon cluster.
     */
    private installRoomIcon(): void {
        this.addHook("ChatRoomDrawCharacterStatusIcons", 1, (args, next) => {
            const result = next(args);
            try {
                this.drawRoomIcon(...args);
            } catch {
                // Drawing extras must never break BC's frame
            }
            return result;
        });
    }

    private drawRoomIcon(C: Character, CharX: number, CharY: number, Zoom: number): void {
        if (this.getSetting<boolean>("roomIcons") === false || typeof C.MemberNumber !== "number") {
            return;
        }
        const character = getChatroomCharacter(C.MemberNumber);
        if (!character?.BCPVersion) {
            return;
        }
        const hasAccess = this.roomIconHasAccess(character);
        const x = CharX + 430 * Zoom;
        const y = CharY;
        const size = 40 * Zoom;
        const drawBadge = (): void => {
            // Light backplate: the purple logo is invisible on dark rooms
            const pad = 3 * Zoom;
            MainCanvas.beginPath();
            MainCanvas.roundRect(x - pad, y - pad, size + 2 * pad, size + 2 * pad, 8 * Zoom);
            MainCanvas.fillStyle = "#efe9f7";
            MainCanvas.fill();
            MainCanvas.strokeStyle = "#3d2e57";
            MainCanvas.lineWidth = Math.max(1, Zoom);
            MainCanvas.stroke();
            DrawImageResize(appLogo, x, y, size, size);
        };
        if (hasAccess) {
            drawBadge();
        } else {
            // Grayed out: this person's permissions give you no access
            MainCanvas.save();
            MainCanvas.globalAlpha = 0.35;
            drawBadge();
            MainCanvas.restore();
        }
        if (MouseIn(x, y, size, size)) {
            const label = `BC+ ${character.BCPVersion}${hasAccess ? "" : " - no access"}`;
            const prevAlign = MainCanvas.textAlign;
            MainCanvas.textAlign = "center";
            DrawRect(x + size / 2 - 150, y + size + 6, 300, 44, "rgba(0, 0, 0, 0.75)");
            DrawTextFit(label, x + size / 2, y + size + 28, 290, "White");
            MainCanvas.textAlign = prevAlign;
        }
    }

    /** Same best-effort preview the remote menu uses (gui.view), cached per second. */
    private roomIconHasAccess(character: BCPlusCharacter): boolean {
        if (character.isPlayer()) {
            return true;
        }
        const member = character.MemberNumber;
        const cached = this.roomIconAccess.get(member);
        const now = Date.now();
        if (cached && cached.until > now) {
            return cached.access;
        }
        const authority = this.ModuleManager.getModule<Authority>("authority");
        const access = authority?.remoteHasPermission(character, "gui.view") ?? false;
        this.roomIconAccess.set(member, { access, until: now + 1000 });
        return access;
    }

    /** Notifies once after an update and stamps the save with the new version. */
    private checkForUpdate(): void {
        const save = this.Storage.Data;
        const savedVersion = parseBCPVersion(save.version);
        const current = parseBCPVersion(BCPLUS_VERSION);
        if (savedVersion === null || current === null) {
            warn(`Could not compare versions (save: ${save.version}, current: ${BCPLUS_VERSION})`);
            return;
        }
        if (BCPVersionCompare(current, savedVersion) > 0 && this.getSetting<boolean>("updateNotify")) {
            InfoBeep(`${BCPLUS_APP_NAME} updated to v${BCPLUS_VERSION}! Changelog: ${BCPLUS_REPO}/blob/main/CHANGE-LOG.md`, 8000);
        }
        if (save.version !== BCPLUS_VERSION) {
            save.version = BCPLUS_VERSION;
        }
    }
}
