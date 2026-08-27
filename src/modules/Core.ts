import menuIcon from "@/assets/icons/core.png";
import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig, PermissionDefinition } from "@/system/module/ModuleTypes";
import { BCPLUS_APP_NAME, BCPLUS_AUTHOR, BCPLUS_REPO, BCPLUS_VERSION, BCPLUS_VERSION_ENDPOINT, BCPLUS_WEBSITE } from "@/system/Constants";
import { log, warn } from "@/system/Console";
import { InfoBeep } from "@/utils/BCUtils";
import { BCPVersionCompare, parseBCPVersion } from "@/utils/Version";
import { AnySetting } from "@/system/gui/Settings";
import { modalConfirm } from "@/gui/Modal";
import { BCPNotifyLines, BCPNotifyPlayer } from "@/utils/Messaging";
import { getChatroomCharacter } from "@/utils/BCPlusCharacter";
import { KnownMember, bindMemberCache, rememberCharacter } from "@/utils/MemberCache";
import { drawPetRings, ringEntriesFromMirror } from "@/system/pet/PetHud";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";
import appLogo from "@/images/icon90.png";
import { Role, RoleNames } from "@/system/Roles";
import type Authority from "@/modules/Authority";
import type Welding from "@/modules/Welding";
import type Rules from "@/modules/Rules";
import type Contracts from "@/modules/Contracts";
import type { GUI as GUIModule } from "@/modules/GUI";

export type BCPPreset = "Dominant" | "Switch" | "Submissive" | "Slave";
export const PRESETS: readonly BCPPreset[] = ["Dominant", "Switch", "Submissive", "Slave"];

/** The Protection rule that forces both hardcore options on while in effect. */
export const HARDCORE_RULE = "protect.hardcore";
/** The two hardcore options; personal Core settings, never editable remotely. */
const HARDCORE_SETTINGS = ["hardcoreSelf", "hardcoreOthers"] as const;

/** Permissions the Slave preset removes self-access to. */
const SLAVE_SELF_LOCKED = ["rules.edit", "curses.edit", "punishments.edit", "punishments.lift", "authority.edit", "roles.assign", "roles.revoke", "relationships.edit", "log.delete", "core.modules"];

/** Update re-check choices; null ms means the login-time check only. */
const UPDATE_INTERVALS: readonly { label: string; ms: number | null }[] = [
    { label: "30 minutes", ms: 30 * 60_000 },
    { label: "1 hour", ms: 60 * 60_000 },
    { label: "3 hours", ms: 180 * 60_000 },
    { label: "6 hours", ms: 360 * 60_000 },
    { label: "Login only", ms: null },
];

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
        Icon: menuIcon,
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
            knownMembers: {},
            conditionPresets: [],
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
                category: "General",
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
                name: "updateChecks",
                category: "Updates",
                label: "Check for updates online",
                hoverText: "Fetches the BC+ release manifest at login and on the re-check interval "
                    + "below. The request carries only the BC+ version you are running - no member "
                    + "number, name or anything else - and its count gives the author anonymous "
                    + "usage numbers. Switch off to stop BC+ from making any update requests at all.",
                default: true,
            },
            {
                type: "checkbox",
                name: "updateNotify",
                category: "Updates",
                label: "Notify me in-club about BC+ updates",
                hoverText: "Shows [BC+] chat messages once after BC+ updated and once per session "
                    + "when a newer version is available (a corner beep when you are not in a "
                    + "room). /bcp updates on|off toggles this too.",
                default: true,
            },
            {
                type: "option",
                name: "updateCheckInterval",
                category: "Updates",
                label: "Re-check for updates every",
                hoverText: "How often BC+ re-reads the release manifest while you stay logged "
                    + "in, so long sessions still hear about new versions. \"Login only\" checks "
                    + "once at login. A found update is announced once per session, following "
                    + "the notification setting above.",
                options: UPDATE_INTERVALS.map((interval) => interval.label),
                default: "1 hour",
            },
            {
                type: "checkbox",
                name: "modalMode",
                category: "Appearance",
                label: "Open BC+ as a floating window",
                hoverText: "Checked, the BC+ window opens small and draggable on top of the club "
                    + "- you can keep reading and using chat while configuring. Unchecked, it "
                    + "opens filling the screen (the maximize button switches either way). "
                    + "/bcp menu opens it directly from a room.",
                default: false,
            },
            {
                type: "option",
                name: "uiTheme",
                category: "Appearance",
                label: "BC+ window theme",
                hoverText: "Color scheme of the BC+ window when the Themed mod is not "
                    + "running - with Themed installed, its palette is used automatically.",
                options: ["Dark", "Light"],
                default: "Dark",
                onSet: () => this.ModuleManager.getModule<GUIModule>("gui")?.applyUiTheme(),
            },
            {
                type: "checkbox",
                name: "roomIcons",
                category: "Appearance",
                label: "Show the BC+ icon above BC+ users in the room",
                hoverText: "Draws the BC+ logo next to BC's status icons above every character "
                    + "running BC+ (including you). Hovering it shows their BC+ version; a grayed "
                    + "icon means their permissions give you no access.",
                default: true,
            },
            {
                type: "checkbox",
                name: "petStatsOthers",
                category: "Appearance",
                label: "Show pet stats under pets who share them",
                hoverText: "Draws the stat rings of every BC+ virtual pet in the room who "
                    + "broadcasts their levels (hover a ring for the exact value). Works "
                    + "without the Pet module - watching pets does not make you one.",
                default: false,
            },
            {
                type: "checkbox",
                name: "hardcoreSelf",
                category: "Hardcore mode",
                label: "Hardcore: block access to my BC+ while I am bound",
                hoverText: "While your hands are bound, your own BC+ menus and /bcp commands "
                    + "refuse to open - no reconfiguring your way out of a scene. Others' remote "
                    + "access to your BC+ keeps working. This is your personal choice: nobody can "
                    + "change it remotely, but the Hardcore Mode rule forces it on while in effect.",
                default: false,
                active: () => !this.hardcoreRuleForced(),
            },
            {
                type: "checkbox",
                name: "hardcoreOthers",
                category: "Hardcore mode",
                label: "Hardcore: block bound people from using my BC+",
                hoverText: "Anyone whose hands are bound is refused when they try to change "
                    + "anything in your BC+ (rules, curses, punishments, roles, commands, ...) - "
                    + "helpless people should not be configuring anyone. This is your personal "
                    + "choice: nobody can change it remotely, but the Hardcore Mode rule forces "
                    + "it on while in effect.",
                default: false,
                active: () => !this.hardcoreRuleForced(),
            },
            ...(this.bcxInstalled() ? [{
                type: "checkbox" as const,
                name: "tandemDefer",
                category: "General",
                label: "Defer to BCX in tandem mode",
                hoverText: "When BCX's version of a BC+ rule is in effect, the BC+ rule pauses "
                    + "so both mods never police the same thing twice. BC+ curses also yield "
                    + "when a BCX curse acts on the same item slot.",
                default: true,
            }] : []),
            ...this.moduleToggleSettings(),
        ];
    }

    /** One on/off checkbox per disableable feature module. */
    private moduleToggleSettings(): AnySetting[] {
        return this.ModuleManager.Modules.filter((m) => m.CanDisable).map((m) => ({
            type: "checkbox" as const,
            name: `module.${m.Slug}`,
            category: "Modules",
            label: `${m.Config.MenuString || m.Config.Name} module enabled`,
            default: m.DefaultEnabled,
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
        // A welded collar or a signed contract keeps the Rules module on -
        // switching it off would silently disarm the locked/bound rules
        if (slug === "rules" && this.rulesModuleLocked() !== null) {
            return true;
        }
        return this.getSetting<boolean>(`module.${slug}`) !== false;
    }

    private isWelded(): boolean {
        return this.ModuleManager.getModule<Welding>("welding")?.isWelded() ?? false;
    }

    /** Why the Rules module cannot be switched off right now, or null when it can. */
    private rulesModuleLocked(): string | null {
        if (this.isWelded()) {
            return "your collar is welded";
        }
        if (this.ModuleManager.getModule<Contracts>("contracts")?.hasBoundRules() === true) {
            return "a signed contract binds your rules";
        }
        return null;
    }

    /** Live-applies a toggle: unload stops the module's hooks/listeners immediately. */
    private applyModuleEnabled(slug: string, enabled: boolean): void {
        const module = this.ModuleManager.getModule(slug);
        if (!module?.CanDisable) {
            return;
        }
        const rulesLock = slug === "rules" && !enabled ? this.rulesModuleLocked() : null;
        if (rulesLock !== null) {
            // Snap the checkbox back too - the stored setting must match
            this.setSetting("module.rules", true);
            BCPNotifyPlayer(`The Rules module stays on while ${rulesLock}.`);
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

    /**
     * The Hardcore Mode rule overrides the two hardcore options at READ time
     * (never writing them): lifting the rule restores the player's own stored
     * choices exactly, with no snapshot to lose or forge.
     */
    override getSetting<T>(name: string): T {
        if ((HARDCORE_SETTINGS as readonly string[]).includes(name) && this.hardcoreRuleForced()) {
            return true as T;
        }
        return super.getSetting(name);
    }

    /** Whether the Hardcore Mode rule currently forces both hardcore options on. */
    hardcoreRuleForced(): boolean {
        const rules = this.ModuleManager.getModule<Rules>("rules");
        if (!rules?.Config.Active || !this.isModuleEnabled("rules")) {
            return false;
        }
        try {
            return rules.peekRuleState(HARDCORE_RULE).enforce && rules.ruleInEffect(HARDCORE_RULE);
        } catch {
            return false;
        }
    }

    /** Hardcore option 1: the player's own BC+ is off-limits right now. */
    hardcoreSelfBlocked(): boolean {
        return this.getSetting<boolean>("hardcoreSelf") === true && !Player.CanInteract();
    }

    /**
     * Hardcore option 2: the reason a remote command from this sender must be
     * refused, or null when it may proceed. Commands travel as chat-room
     * messages, so the sender is in the room and their restraints are visible;
     * an unknown sender is let through (nothing to judge them by).
     */
    hardcoreSenderBlock(senderNumber: number): string | null {
        if (this.getSetting<boolean>("hardcoreOthers") !== true) {
            return null;
        }
        const character = (ChatRoomCharacter ?? []).find((c) => c.MemberNumber === senderNumber);
        if (character && !character.CanInteract()) {
            return "your hands are bound (hardcore mode)";
        }
        return null;
    }

    /** The player's current preset. */
    getPreset(): BCPPreset {
        const value = this.getSetting<string>("preset");
        return (PRESETS as readonly string[]).includes(value) ? value as BCPPreset : "Switch";
    }

    /** While in the future, the reset button is armed and a second click wipes. */
    private resetArmedUntil = 0;

    /**
     * Factory reset without a confirm dialog - callers arm their own
     * confirmation (the General page's two-click button, /bcp reset's modal).
     * A welded collar disables it entirely: it would be a one-click escape.
     */
    async factoryReset(): Promise<boolean> {
        if (this.isWelded()) {
            return false;
        }
        const wiped = await this.Storage.wipeAllData(false);
        if (wiped) {
            BCPNotifyPlayer("BC+ has been reset. Reloading...");
            setTimeout(() => window.location.reload(), 1500);
        }
        return wiped;
    }

    /** Whether the factory reset is available (a welded collar blocks it). */
    canFactoryReset(): boolean {
        return !this.isWelded();
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

    /** The version already announced this session; re-checks stay quiet about it. */
    private notifiedVersion: string | null = null;

    /** Pacing for periodic re-checks: one light timer compares elapsed time to the setting. */
    private updateCheckTimer: ReturnType<typeof setInterval> | null = null;
    private lastUpdateCheck = 0;

    getLatestVersion(): string | null {
        return this.latestVersion;
    }

    /** Fetches the manifest again once the configured re-check interval has elapsed. */
    private maybeRecheckUpdates(): void {
        const chosen = UPDATE_INTERVALS.find((interval) => interval.label === this.getSetting<string>("updateCheckInterval"));
        const ms = chosen !== undefined ? chosen.ms : 60 * 60_000;
        if (ms === null) {
            return;
        }
        if (Date.now() - this.lastUpdateCheck >= ms) {
            void this.fetchLatestVersion("interval");
        }
    }

    private async fetchLatestVersion(kind: "login" | "interval"): Promise<void> {
        // Stamped even when the fetch fails - being offline must not turn the
        // pacing timer into a once-a-minute retry hammer
        this.lastUpdateCheck = Date.now();
        if (this.getSetting<boolean>("updateChecks") === false) {
            return;
        }
        try {
            // The endpoint's request count is the anonymous usage metric; only
            // the running version and the check kind travel with it. Dev
            // builds tag themselves so they can be filtered out of the counts.
            const params = `?v=${encodeURIComponent(BCPLUS_VERSION)}&t=${BCP_DEV_ENV ? "dev" : kind}`;
            let response: Response | null = null;
            try {
                response = await fetch(`${BCPLUS_VERSION_ENDPOINT}${params}`, { cache: "no-store" });
            } catch {
                response = null;
            }
            if (response === null || !response.ok) {
                // Metrics endpoint down - update checks fall back to the source
                response = await fetch(`${BCPLUS_WEBSITE}/version.json`, { cache: "no-store" });
            }
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

    /** Chat notices waiting for the player to be in a room (where local chat works). */
    private readonly pendingChatNotices: string[][] = [];

    /**
     * Shows boxed [BC+] chat lines now, or on the next room join when outside
     * a room (ChatRoomSendLocal no-ops there - the summon-rule lesson).
     */
    private queueChatNotice(lines: string[]): void {
        if (ServerPlayerIsInChatRoom()) {
            BCPNotifyLines(lines);
        } else {
            this.pendingChatNotices.push(lines);
        }
    }

    /** Notifies when a newer release than the running build is available. */
    private notifyIfOutdated(): void {
        const latest = this.latestVersion !== null ? parseBCPVersion(this.latestVersion) : null;
        const current = parseBCPVersion(BCPLUS_VERSION);
        if (latest === null || current === null) {
            return;
        }
        if (BCPVersionCompare(latest, current) > 0 && this.getSetting<boolean>("updateNotify")) {
            // Periodic re-checks announce each new version once per session
            if (this.latestVersion === this.notifiedVersion) {
                return;
            }
            this.notifiedVersion = this.latestVersion;
            this.queueChatNotice([
                `&#128276; Update available - v${this.latestVersion} is out (you have v${BCPLUS_VERSION}).`,
                "Reload the page to get the latest version.",
                "To silence these: /bcp updates off",
            ]);
            if (!ServerPlayerIsInChatRoom()) {
                InfoBeep(`${BCPLUS_APP_NAME} v${this.latestVersion} is available - reload the club to update!`, 8000);
            }
        }
    }

    override Unload(): void {
        if (this.updateCheckTimer !== null) {
            clearInterval(this.updateCheckTimer);
            this.updateCheckTimer = null;
        }
        super.Unload();
    }

    /** DEV builds only: forces an immediate manifest fetch. */
    devForceUpdateCheck(): void {
        if (!BCP_DEV_ENV) {
            return;
        }
        void this.fetchLatestVersion("interval");
    }

    /** DEV builds only: fakes the latest-version manifest; null re-fetches the real one. */
    devSetLatestVersion(version: string | null): void {
        if (!BCP_DEV_ENV) {
            return;
        }
        this.latestVersion = version;
        if (version === null) {
            void this.fetchLatestVersion("interval");
        } else {
            this.notifyIfOutdated();
        }
    }

    override Load(): void {
        this.checkForUpdate();
        void this.fetchLatestVersion("login");
        this.updateCheckTimer = setInterval(() => this.maybeRecheckUpdates(), 60_000);
        this.installRoomIcon();
        bindMemberCache(this.Data.knownMembers as Record<string, KnownMember>);

        // Flush queued chat notices once the player lands in a room; small
        // delay so BC finishes building the chat log first
        this.addHook("ChatRoomSync", 0, (args, next) => {
            const result = next(args);
            this.captureRoomMembers();
            this.Events.emit("roomMembersChanged", undefined);
            if (this.pendingChatNotices.length > 0) {
                const notices = this.pendingChatNotices.splice(0);
                setTimeout(() => notices.forEach((lines) => BCPNotifyLines(lines)), 500);
            }
            return result;
        });
        this.addHook("ChatRoomSyncMemberJoin", 0, (args, next) => {
            const result = next(args);
            this.captureRoomMembers();
            this.Events.emit("roomMembersChanged", undefined);
            return result;
        });
        this.addHook("ChatRoomSyncMemberLeave", 0, (args, next) => {
            const result = next(args);
            // Open remote views re-check their target on this bump and show
            // the departed message the moment the member is gone
            this.Events.emit("roomMembersChanged", undefined);
            return result;
        });
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

    /** Remembers everyone currently in the room, so their names survive them going offline. */
    private captureRoomMembers(): void {
        for (const character of ChatRoomCharacter ?? []) {
            rememberCharacter(character);
        }
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
            try {
                this.drawOtherPetStats(...args);
            } catch {
                // Same rule for the pet rings
            }
            return result;
        });
    }

    /**
     * Stat rings under OTHER pets who broadcast their levels, drawn from
     * their synced mirror. Lives here (not in the Pet module) so watching
     * pets never requires opting into being one; the pet's own rings are
     * the Pet module's business.
     */
    private drawOtherPetStats(C: Character, CharX: number, CharY: number, Zoom: number): void {
        if (this.getSetting<boolean>("petStatsOthers") !== true
            || C.IsPlayer() || typeof C.MemberNumber !== "number") {
            return;
        }
        const character = getChatroomCharacter(C.MemberNumber);
        if (!character?.BCPVersion) {
            return;
        }
        this.mpaPresent ??= this.SDK.modInstalled("MPA");
        drawPetRings(
            ringEntriesFromMirror(character.BCPData?.["pet"]),
            CharX, CharY, Zoom,
            { raise: this.mpaPresent },
        );
    }

    /** Cached once - checked per character per frame. */
    private mpaPresent: boolean | null = null;

    private drawRoomIcon(C: Character, CharX: number, CharY: number, Zoom: number): void {
        if (this.getSetting<boolean>("roomIcons") === false || typeof C.MemberNumber !== "number") {
            return;
        }
        const character = getChatroomCharacter(C.MemberNumber);
        if (!character?.BCPVersion) {
            return;
        }
        const hasAccess = this.roomIconHasAccess(character);
        // In-row gap between BC's relationship slot (ends at 190) and the
        // WCE-adjacent companion icon (~228): a 38px window, so the badge is
        // drawn a hair slimmer than BC's 40px icons. Slot 0 looked attached
        // to the neighboring character's cluster; the right end is WCE's.
        const x = CharX + 190 * Zoom;
        const y = CharY;
        const size = 36 * Zoom;
        MainCanvas.save();
        if (!hasAccess) {
            // Grayed out: this person's permissions give you no access
            MainCanvas.globalAlpha = 0.35;
        }
        // Soft white halo instead of a backplate: keeps the flat icon look
        // while staying visible on dark backgrounds
        MainCanvas.shadowColor = "rgba(255, 255, 255, 0.9)";
        MainCanvas.shadowBlur = 4 * Zoom;
        DrawImageResize(appLogo, x, y, size, size);
        DrawImageResize(appLogo, x, y, size, size);
        MainCanvas.restore();
        // Welded collar marker: a small lock on the badge corner, visible to
        // everyone with BC+ (the welded flag is public-synced)
        const welded = character.isPlayer()
            ? this.isWelded()
            : character.BCPData?.["welding"]?.["welded"] === true;
        if (welded) {
            const lock = 20 * Zoom;
            const lockX = x + size - lock * 0.75;
            const lockY = y + size - lock * 0.75;
            MainCanvas.save();
            // Light disc with a dark red ring: BC's lock glyph is dark, so it
            // needs a bright backplate to read at this size
            MainCanvas.beginPath();
            MainCanvas.arc(lockX + lock / 2, lockY + lock / 2, lock * 0.62, 0, Math.PI * 2);
            MainCanvas.fillStyle = "#f2eefa";
            MainCanvas.fill();
            MainCanvas.lineWidth = Math.max(1.5, 2 * Zoom);
            MainCanvas.strokeStyle = "#7a1010";
            MainCanvas.stroke();
            DrawImageResize("Icons/Lock.png", lockX, lockY, lock, lock);
            MainCanvas.restore();
        }
        if (MouseIn(x, y, size, size)) {
            const label = `BC+ ${character.BCPVersion}${welded ? " - collar welded" : ""}${hasAccess ? "" : " - no access"}`;
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
            this.queueChatNotice([
                `&#128276; ${BCPLUS_APP_NAME} updated to v${BCPLUS_VERSION}.`,
                `See what changed: <a href="${BCPLUS_REPO}/blob/main/CHANGE-LOG.md" target="_blank" `
                    + "style='color:#b794e6'>change log</a>",
            ]);
            if (!ServerPlayerIsInChatRoom()) {
                InfoBeep(`${BCPLUS_APP_NAME} updated to v${BCPLUS_VERSION}!`, 8000);
            }
        }
        if (save.version !== BCPLUS_VERSION) {
            save.version = BCPLUS_VERSION;
        }
    }
}
