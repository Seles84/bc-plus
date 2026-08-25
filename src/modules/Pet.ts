import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig, PermissionDefinition, SettingsFooterRenderer } from "@/system/module/ModuleTypes";
import { BCPLUS_AUTHOR, BCPLUS_STORAGE, BCPLUS_VERSION } from "@/system/Constants";
import { Role } from "@/system/Roles";
import { AnySetting } from "@/system/gui/Settings";
import {
    DRAIN_CHOICES, OFFLINE_FLOOR_CHOICES, OFFLINE_MODES, OFFLINE_MODE_DRAIN,
    PET_STATS, PetLevels, PetStatId, clampLevel, drainHoursValue, drainedLevel, offlineFloorValue,
} from "@/system/pet/PetTypes";
import { debug } from "@/system/Console";
import type Authority from "@/modules/Authority";

/** How often the last-seen stamp in localStorage is refreshed while playing. */
const ONLINE_STAMP_MS = 10_000;

/**
 * Virtual pet needs, inspired by MPA by Maya: food, water, sleep and affection
 * drain over configurable spans and show as stat rings under your character.
 *
 * Levels are stored with a timestamp and every read derives the current value
 * from elapsed time - no tick ever writes to storage. Storage is only touched
 * when the baseline must move: drain-speed changes, refills, unload, and the
 * offline catch-up at login (which localStorage's last-seen stamp separates
 * from online time, so "pause while offline" knows what actually was offline).
 */
export default class Pet extends ModuleInstance {

    private onlineStampTimer: ReturnType<typeof setInterval> | null = null;

    protected readonly SystemConfig: ModuleConfig = {
        Name: "Pet",
        Version: BCPLUS_VERSION,
        Author: BCPLUS_AUTHOR,
        Description: "Virtual pet needs: food, water, sleep and affection",
        Active: true,
        Icon: "Icons/Horse.png",
        HoverText: "Become a virtual pet: food, water, sleep and affection slowly drain and "
            + "show as stat rings under your character. This first version brings the needs "
            + "and their drain settings - feeding, petting and sleep recovery follow in a "
            + "later update (refill by hand until then). Inspired by MPA by Maya.",
        PublicData: false,
        Reference: "pet",
        MenuString: "Pet",
    };

    override get Permissions(): PermissionDefinition[] {
        return [{
            id: "pet.edit",
            label: "Change my pet settings",
            defaultRole: Role.Owner,
            defaultSelf: true,
        }];
    }

    override get CanDisable(): boolean {
        return true;
    }

    override get DefaultEnabled(): boolean {
        // Petplay is opt-in: nobody gets needs they never asked for
        return false;
    }

    override get EditPermission(): string | null {
        return "pet.edit";
    }

    override get Settings(): AnySetting[] {
        return [
            {
                type: "checkbox",
                name: "hudSelf",
                label: "Show your pet stats under your character",
                hoverText: "Draws a small ring per need at your character's feet in chat rooms. "
                    + "Hover a ring for the exact value.",
                default: true,
            },
            {
                type: "checkbox",
                name: "hudNumbers",
                label: "Show exact percentages on the stat rings",
                default: false,
            },
            ...PET_STATS.map((stat) => ({
                type: "option" as const,
                name: stat.drainSetting,
                label: `${stat.label} runs out after`,
                hoverText: `How long a full ${stat.label.toLowerCase()} bar lasts before it `
                    + "reaches empty. \"Off\" removes the need entirely (its ring disappears).",
                options: DRAIN_CHOICES.map((c) => c.label),
                default: stat.drainDefault,
                // Fold time-so-far at the OLD speed before the new one takes over
                onSet: (_value: string, prev: string) => this.rebase({ [stat.id]: drainHoursValue(prev, stat.drainDefault) }),
            })),
            {
                type: "option",
                name: "offlineMode",
                label: "While logged out",
                hoverText: "Whether your needs keep draining while you are not in the club. "
                    + "Draining is softened by the floor setting below.",
                options: [...OFFLINE_MODES],
                default: OFFLINE_MODE_DRAIN,
            },
            {
                type: "option",
                name: "offlineFloor",
                label: "Offline drain stops at",
                hoverText: "Time spent logged out never pulls a stat below this level "
                    + "(a stat already below it just stays where it was).",
                options: OFFLINE_FLOOR_CHOICES.map((c) => c.label),
                default: "20%",
                active: () => this.getSetting<string>("offlineMode") === OFFLINE_MODE_DRAIN,
            },
        ];
    }

    override get Defaults(): Record<string, unknown> {
        return {
            ...super.Defaults,
            levels: null,
            stampedAt: 0,
            paused: false,
        };
    }

    override get SettingsFooter(): SettingsFooterRenderer | null {
        return (addClickHandler) => {
            const editable = this.canEdit();
            const prevAlign = MainCanvas.textAlign;
            MainCanvas.textAlign = "center";
            DrawButton(150, 880, 340, 70, "Refill all stats", editable ? "White" : "#ddd", "",
                editable
                    ? "Top every need back up to 100% (/bcp pet refill works too)"
                    : "You are not permitted to change your pet settings", !editable);
            MainCanvas.textAlign = prevAlign;
            addClickHandler(() => {
                if (editable && MouseIn(150, 880, 340, 70)) {
                    this.refill();
                }
            });
        };
    }

    canEdit(): boolean {
        const authority = this.ModuleManager.getModule<Authority>("authority");
        return authority?.hasPermission(Player.MemberNumber ?? -1, "pet.edit") ?? false;
    }

    /** The needs currently in play (drain not set to Off), with their configured hours. */
    activeStats(): { id: PetStatId; label: string; color: string; hours: number }[] {
        const result: { id: PetStatId; label: string; color: string; hours: number }[] = [];
        for (const stat of PET_STATS) {
            const hours = this.statHours(stat.id);
            if (hours !== null) {
                result.push({ id: stat.id, label: stat.label, color: stat.color, hours });
            }
        }
        return result;
    }

    /** Live levels, derived from the stored baseline plus elapsed drain. */
    currentLevels(): PetLevels {
        const stored = this.storedLevels();
        const elapsed = Date.now() - this.stampedAt();
        const result = {} as PetLevels;
        for (const stat of PET_STATS) {
            result[stat.id] = drainedLevel(stored[stat.id], this.statHours(stat.id), elapsed);
        }
        return result;
    }

    /** Tops every need back up to 100. */
    refill(): void {
        const full = {} as PetLevels;
        for (const stat of PET_STATS) {
            full[stat.id] = 100;
        }
        this.Data.levels = full;
        this.Data.stampedAt = Date.now();
    }

    /**
     * Folds elapsed drain into the stored levels and restarts the clock.
     * `hourOverrides` supplies the previous speed for a stat whose drain
     * setting just changed, so its past time is charged at the old rate.
     */
    rebase(hourOverrides: Partial<Record<PetStatId, number | null>> = {}): void {
        const stored = this.storedLevels();
        const elapsed = Date.now() - this.stampedAt();
        const folded = {} as PetLevels;
        for (const stat of PET_STATS) {
            const hours = stat.id in hourOverrides ? (hourOverrides[stat.id] ?? null) : this.statHours(stat.id);
            folded[stat.id] = drainedLevel(stored[stat.id], hours, elapsed);
        }
        this.Data.levels = folded;
        this.Data.stampedAt = Date.now();
    }

    override Load(): void {
        this.applyOfflineElapsed();
        this.stampOnline();
        this.onlineStampTimer = setInterval(() => this.stampOnline(), ONLINE_STAMP_MS);
        this.installHud();
    }

    override Unload(): void {
        if (this.onlineStampTimer !== null) {
            clearInterval(this.onlineStampTimer);
            this.onlineStampTimer = null;
        }
        // Freeze the pet: fold drain up to now and mark the gap that follows
        // as a deliberate off period, not offline time to catch up on
        this.rebase();
        this.Data.paused = true;
        super.Unload();
    }

    private statHours(id: PetStatId): number | null {
        const stat = PET_STATS.find((s) => s.id === id)!;
        return drainHoursValue(this.getSetting<string>(stat.drainSetting), stat.drainDefault);
    }

    private storedLevels(): PetLevels {
        const raw = this.Data.levels as Partial<PetLevels> | null;
        const result = {} as PetLevels;
        for (const stat of PET_STATS) {
            const value = raw?.[stat.id];
            result[stat.id] = typeof value === "number" && Number.isFinite(value) ? clampLevel(value) : 100;
        }
        return result;
    }

    private stampedAt(): number {
        const raw = this.Data.stampedAt;
        return typeof raw === "number" && raw > 0 ? raw : Date.now();
    }

    /**
     * Login catch-up: time between the baseline stamp and the last-seen stamp
     * was online play and drains fully; time after last-seen was offline and
     * follows the offline setting (pause, or drain down to the floor). A pet
     * that was switched off (paused) just resumes where it stood.
     */
    private applyOfflineElapsed(): void {
        const now = Date.now();
        if (this.Data.levels === null || typeof this.Data.levels !== "object") {
            this.refill();
            this.Data.paused = false;
            return;
        }
        if (this.Data.paused === true) {
            this.Data.paused = false;
            this.Data.stampedAt = now;
            return;
        }

        const stamped = this.stampedAt();
        const lastOnline = this.readOnlineStamp() ?? stamped;
        const onlineMs = Math.max(0, lastOnline - stamped);
        const offlineMs = Math.max(0, now - Math.max(lastOnline, stamped));
        const drainOffline = this.getSetting<string>("offlineMode") === OFFLINE_MODE_DRAIN;
        const floor = offlineFloorValue(this.getSetting<string>("offlineFloor"));

        const stored = this.storedLevels();
        const folded = {} as PetLevels;
        for (const stat of PET_STATS) {
            const hours = this.statHours(stat.id);
            let level = drainedLevel(stored[stat.id], hours, onlineMs);
            if (drainOffline) {
                // Never below the floor - unless the stat already was
                level = Math.max(drainedLevel(level, hours, offlineMs), Math.min(level, floor));
            }
            folded[stat.id] = level;
        }
        this.Data.levels = folded;
        this.Data.stampedAt = now;
        debug(`Pet offline catch-up: ${Math.round(onlineMs / 1000)}s online, `
            + `${Math.round(offlineMs / 1000)}s offline (${drainOffline ? `drain, floor ${floor}` : "paused"})`);
    }

    /** localStorage, not Data: refreshing this every few seconds must never sync a save. */
    private onlineStampKey(): string {
        return `${BCPLUS_STORAGE}_${Player.MemberNumber}_PetOnline`;
    }

    private stampOnline(): void {
        try {
            localStorage.setItem(this.onlineStampKey(), String(Date.now()));
        } catch {
            // Storage full or blocked - offline detection degrades gracefully
        }
    }

    private readOnlineStamp(): number | null {
        try {
            const raw = localStorage.getItem(this.onlineStampKey());
            const value = raw === null ? Number.NaN : Number(raw);
            return Number.isFinite(value) && value > 0 ? value : null;
        } catch {
            return null;
        }
    }

    // ------------------------------------------------------------------ HUD

    private installHud(): void {
        this.addHook("ChatRoomDrawCharacterStatusIcons", 1, (args, next) => {
            const result = next(args);
            try {
                this.drawHud(...args);
            } catch {
                // Drawing extras must never break BC's frame
            }
            return result;
        });
    }

    private drawHud(C: Character, CharX: number, CharY: number, Zoom: number): void {
        if (!C.IsPlayer() || this.getSetting<boolean>("hudSelf") === false) {
            return;
        }
        const stats = this.activeStats();
        if (stats.length === 0) {
            return;
        }
        const levels = this.currentLevels();
        const radius = 16 * Zoom;
        const spacing = 40 * Zoom;
        const y = CharY + 950 * Zoom;
        const startX = CharX + 250 * Zoom - ((stats.length - 1) * spacing) / 2;
        const showNumbers = this.getSetting<boolean>("hudNumbers") === true;

        let hovered: { x: number; label: string; percent: number } | null = null;
        stats.forEach((stat, i) => {
            const x = startX + i * spacing;
            const level = levels[stat.id];
            this.drawStatRing(x, y, radius, level / 100, stat.color);
            if (showNumbers) {
                const prevAlign = MainCanvas.textAlign;
                MainCanvas.textAlign = "center";
                DrawTextFit(String(Math.round(level)), x, y, radius * 1.5, "White", "Black");
                MainCanvas.textAlign = prevAlign;
            }
            if (MouseIn(x - radius, y - radius, radius * 2, radius * 2)) {
                hovered = { x, label: stat.label, percent: Math.round(level) };
            }
        });

        // Tooltip after all rings, so it overlays its neighbors
        if (hovered !== null) {
            const tip = hovered as { x: number; label: string; percent: number };
            const prevAlign = MainCanvas.textAlign;
            MainCanvas.textAlign = "center";
            DrawRect(tip.x - 110, y - radius - 54, 220, 44, "rgba(0, 0, 0, 0.75)");
            DrawTextFit(`${tip.label}: ${tip.percent}%`, tip.x, y - radius - 32, 210, "White");
            MainCanvas.textAlign = prevAlign;
        }
    }

    /** A ring outline with a pie fill for the current fraction, MPA-style. */
    private drawStatRing(x: number, y: number, radius: number, fraction: number, color: string): void {
        MainCanvas.save();
        // Soft light halo so the saturated rings read on dark backdrops too
        MainCanvas.beginPath();
        MainCanvas.arc(x, y, radius, 0, Math.PI * 2);
        MainCanvas.fillStyle = "rgba(255, 255, 255, 0.35)";
        MainCanvas.fill();
        MainCanvas.lineWidth = Math.max(1.5, radius / 8);
        MainCanvas.strokeStyle = color;
        MainCanvas.stroke();
        if (fraction > 0) {
            MainCanvas.beginPath();
            MainCanvas.moveTo(x, y);
            MainCanvas.arc(x, y, radius * 0.8, -Math.PI / 2, -Math.PI / 2 - Math.PI * 2 * Math.min(1, fraction), true);
            MainCanvas.closePath();
            MainCanvas.fillStyle = color;
            MainCanvas.fill();
        }
        MainCanvas.restore();
    }
}
