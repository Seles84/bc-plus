import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig, PermissionDefinition, SettingsFooterRenderer } from "@/system/module/ModuleTypes";
import { BCPLUS_AUTHOR, BCPLUS_STORAGE, BCPLUS_VERSION } from "@/system/Constants";
import { Role } from "@/system/Roles";
import { AnySetting } from "@/system/gui/Settings";
import {
    AFFECTION_LIKE_ACTIVITIES, AFFECTION_LIKE_GAIN, AFFECTION_LOVE_ACTIVITIES, AFFECTION_LOVE_GAIN,
    AFFECTION_ROUGH_ACTIVITIES, AFFECTION_ROUGH_LOSS, AFFECTION_ZONE_WEIGHT,
    BCP_BOWL_DRINK, BCP_BOWL_EAT, BOWL_RECOVERY, DRAIN_CHOICES, FOOD_ACTIVITY_NAMES, ITEM_RECOVERY,
    OFFLINE_FLOOR_CHOICES, OFFLINE_MODES, OFFLINE_MODE_DRAIN, ORGASM_SLEEP_COST, ORGASM_WATER_COST,
    PET_STATS, PetLevels, PetStatId, SEX_PET_GAIN, SEX_PET_MODES, SEX_PET_ORAL_ACTIVITIES,
    SEX_PET_ORGASM_WINDOW_MS, SEX_PET_REGIONS, SEX_PET_THIRST_MULTIPLIER, WATER_ACTIVITY_NAMES,
    chatDictAttr, clampLevel, coarseLevel, drainHoursValue, drainedLevel, offlineFloorValue, sleepFactor,
} from "@/system/pet/PetTypes";
import { drawPetRings } from "@/system/pet/PetHud";
import { BCP_ACTIVITY_PREFIX, CustomActivityRegistry } from "@/utils/CustomActivities";
import { SendAction } from "@/utils/Messaging";
import { debug } from "@/system/Console";
import type Authority from "@/modules/Authority";
import type Roles from "@/modules/Roles";

/** How often the last-seen stamp in localStorage is refreshed while playing. */
const ONLINE_STAMP_MS = 10_000;
/** How often gains/recovery are persisted (every save syncs to the BC server). */
const FLUSH_MS = 5 * 60_000;
/** How often the sleep-state check (appearance scan) is refreshed. */
const SLEEP_CHECK_MS = 1_000;

/**
 * Virtual pet needs, inspired by MPA by Maya: food, water, sleep and affection
 * drain over configurable spans, are refilled through play (feeding, petting,
 * sleeping) and show as stat rings under your character.
 *
 * The live levels live IN MEMORY and fold elapsed drain/recovery on every
 * read; gains land in memory too. Storage sees a baseline (levels + stamp)
 * written only every few minutes when something beyond plain drain happened -
 * pure drain is re-derivable and never needs a write. localStorage's last-seen
 * stamp (never a save sync) separates online from offline time at login.
 */
export default class Pet extends ModuleInstance {

    private onlineStampTimer: ReturnType<typeof setInterval> | null = null;

    /** Live levels; null until Load seeds them from storage. */
    private live: PetLevels | null = null;
    private liveStamp = 0;
    /** Whether memory holds changes storage does not (gains, sleep recovery). */
    private dirty = false;
    private lastFlush = 0;
    private sleepFactorCache = -1;
    private sleepFactorAt = 0;
    /** When the pet last went down on someone, for the sex-pet reward window. */
    private readonly oralAt = new Map<number, number>();

    private readonly activities = new CustomActivityRegistry();
    private mpaPresent = false;

    protected readonly SystemConfig: ModuleConfig = {
        Name: "Pet",
        Version: BCPLUS_VERSION,
        Author: BCPLUS_AUTHOR,
        Description: "Virtual pet needs: food, water, sleep and affection",
        Active: true,
        Icon: "Icons/Horse.png",
        HoverText: "Become a virtual pet: food, water, sleep and affection drain over time and "
            + "show as stat rings under your character. Being fed and watered (food items, pet "
            + "bowls), petted and cuddled, and sleeping (eyes closed with a sleepy emoticon - "
            + "beds help) fills them back up. Stats can be shared with the room and configured "
            + "remotely by those permitted. Inspired by MPA by Maya.",
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

    override get SupportsRemote(): boolean {
        return true;
    }

    override get Settings(): AnySetting[] {
        return [
            // Page 1: what kind of pet you are
            {
                type: "checkbox",
                name: "bePet",
                label: "Be a virtual pet (needs drain and can be filled)",
                hoverText: "The master switch for your own needs. Off, your levels freeze and "
                    + "nothing drains or gains - useful when you only want to SEE other pets' "
                    + "stats without being one.",
                default: true,
                onSet: () => this.flush(),
            },
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
            {
                type: "checkbox",
                name: "shareStats",
                label: "Share your pet stats with the room",
                hoverText: "Broadcasts your levels (rounded, a few times an hour) to BC+ users "
                    + "in the room so they can see your rings. Off, your stats stay entirely "
                    + "on your side.",
                default: true,
            },
            {
                type: "checkbox",
                name: "orgasmCost",
                label: "Orgasms cost hydration and energy",
                hoverText: "Climaxing takes a bite out of your water and sleep levels.",
                default: true,
            },
            {
                type: "checkbox",
                name: "masochist",
                label: "Masochist: rough treatment raises affection",
                hoverText: "Spanks, slaps, bites and shocks gain affection instead of losing it.",
                default: false,
            },
            {
                type: "option",
                name: "sexPet",
                label: "Sex pet: oral play nourishes you",
                hoverText: "Going down on someone feeds you a little - and if they finish "
                    + "shortly after, you drink deep. The mode sets how nourishing it is.",
                options: [...SEX_PET_MODES],
                default: "Off",
            },
            // Page 2: drain speeds and offline behavior
            ...PET_STATS.map((stat) => ({
                type: "option" as const,
                name: stat.drainSetting,
                label: `${stat.label} runs out after`,
                hoverText: `How long a full ${stat.label.toLowerCase()} bar lasts before it `
                    + "reaches empty. \"Off\" removes the need entirely (its ring disappears).",
                options: DRAIN_CHOICES.map((c) => c.label),
                default: stat.drainDefault,
                onSet: () => this.flush(),
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

    /** Whether the own needs machinery runs (module on + "be a pet" on). */
    isPet(): boolean {
        return this.Config.Active && this.getSetting<boolean>("bePet") !== false;
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

    /** Live levels; folds elapsed drain/recovery first. */
    currentLevels(): PetLevels {
        this.updateLive();
        return { ...(this.live ?? this.storedLevels()) };
    }

    /** Tops every need back up to 100. */
    refill(): void {
        const full = {} as PetLevels;
        for (const stat of PET_STATS) {
            full[stat.id] = 100;
        }
        this.live = full;
        this.liveStamp = Date.now();
        this.dirty = true;
        this.flush();
    }

    /**
     * The coarse public view of this pet for room broadcast: rounded levels of
     * the active needs plus the declared settings (so remote settings mirrors
     * stay complete when this category replaces them). A minimal record while
     * not a pet or not sharing, so viewers drop stale rings.
     */
    publicPetData(): Record<string, unknown> {
        if (!this.isPet() || this.getSetting<boolean>("shareStats") === false) {
            return { shareStats: false };
        }
        const levels: Record<string, number> = {};
        const current = this.currentLevels();
        for (const stat of this.activeStats()) {
            levels[stat.id] = coarseLevel(current[stat.id]);
        }
        const values = Object.fromEntries(this.Settings.map((s) => [s.name, this.getSetting(s.name)]));
        return { ...values, levels };
    }

    override Load(): void {
        this.mpaPresent = this.SDK.modInstalled("MPA");
        this.applyOfflineElapsed();
        this.live = this.storedLevels();
        this.liveStamp = Date.now();
        this.lastFlush = Date.now();
        this.stampOnline();
        this.onlineStampTimer = setInterval(() => {
            this.stampOnline();
            this.updateLive();
            if (this.dirty && Date.now() - this.lastFlush >= FLUSH_MS) {
                this.flush();
            }
        }, ONLINE_STAMP_MS);
        this.installHud();
        this.installGains();
        this.installBowlActivities();
    }

    override Unload(): void {
        if (this.onlineStampTimer !== null) {
            clearInterval(this.onlineStampTimer);
            this.onlineStampTimer = null;
        }
        this.activities.unregisterAll();
        this.oralAt.clear();
        // Freeze the pet: fold everything up to now and mark the gap that
        // follows as a deliberate off period, not offline time to catch up on
        this.flush();
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

    // ------------------------------------------------------------- Engine

    private cachedSleepFactor(now: number): number {
        if (now - this.sleepFactorAt >= SLEEP_CHECK_MS) {
            this.sleepFactorAt = now;
            try {
                this.sleepFactorCache = sleepFactor(Player);
            } catch {
                this.sleepFactorCache = -1;
            }
        }
        return this.sleepFactorCache;
    }

    /** Folds elapsed drain (and sleep recovery) into the live levels. */
    private updateLive(): void {
        const now = Date.now();
        if (this.live === null) {
            this.live = this.storedLevels();
            this.liveStamp = now;
            return;
        }
        const elapsed = now - this.liveStamp;
        this.liveStamp = now;
        if (elapsed <= 0 || !this.isPet()) {
            return;
        }
        for (const stat of PET_STATS) {
            const hours = this.statHours(stat.id);
            if (hours === null) {
                continue;
            }
            let factor = -1;
            if (stat.id === "sleep") {
                factor = this.cachedSleepFactor(now);
                if (factor > 0) {
                    // Recovery is a real change storage cannot re-derive
                    this.dirty = true;
                }
            }
            const delta = (elapsed / (hours * 3_600_000)) * 100 * factor;
            this.live[stat.id] = clampLevel(this.live[stat.id] + delta);
        }
    }

    /** Persists the live levels as the new storage baseline. */
    private flush(): void {
        this.updateLive();
        if (this.live === null) {
            return;
        }
        this.Data.levels = { ...this.live };
        this.Data.stampedAt = this.liveStamp;
        this.dirty = false;
        this.lastFlush = Date.now();
    }

    /**
     * Adds to one need (negative = cost). Positive gains are scaled by the
     * pet-treatment modifier unless `flat`. No-op for needs set to Off.
     */
    private gainStat(stat: PetStatId, amount: number, source?: Character | null, flat = false): void {
        if (!this.isPet() || this.statHours(stat) === null || amount === 0) {
            return;
        }
        this.updateLive();
        if (this.live === null) {
            return;
        }
        const scaled = amount > 0 && !flat ? amount * this.gainModifier(stat, source ?? null) : amount;
        this.live[stat] = clampLevel(this.live[stat] + scaled);
        this.dirty = true;
        debug(`Pet ${stat} ${scaled >= 0 ? "+" : ""}${Math.round(scaled * 10) / 10} -> ${Math.round(this.live[stat])}`);
    }

    /** How well care counts: who gives it and how pet-like you are receiving it. */
    private gainModifier(stat: PetStatId, source: Character | null): number {
        let modifier = 1;
        const sourceNumber = source?.MemberNumber;
        if (typeof sourceNumber === "number" && sourceNumber !== Player.MemberNumber) {
            const role = this.ModuleManager.getModule<Roles>("roles")?.highestRole(sourceNumber) ?? Role.Public;
            if (role <= Role.Owner) {
                modifier += 0.5;
            } else if (role === Role.Lover) {
                modifier += 0.35;
            } else if (role === Role.Mistress) {
                modifier += 0.25;
            }
        }
        try {
            // Hard to eat or drink around a gag
            if ((stat === "food" || stat === "water") && !Player.CanTalk()) {
                modifier -= 0.5;
            }
            // Restraints and an all-fours pose are very pet-like
            modifier += 0.03 * Player.Appearance.filter((a) => a.Asset.Group.Name.startsWith("Item")).length;
            if (Player.PoseMapping?.BodyFull === "AllFours") {
                modifier += 0.5;
            }
        } catch {
            // Appearance quirks must never block a gain entirely
        }
        return Math.max(0, modifier);
    }

    // ------------------------------------------------------------- Gains

    private installGains(): void {
        this.addHook("ChatRoomMessage", 1, (args, next) => {
            try {
                this.onChatMessage(args[0]);
            } catch {
                // A malformed message must never break the chat chain
            }
            return next(args);
        });

        // Own orgasm cost; BC calls this once per orgasm event and the global
        // ActivityOrgasmRuined says whether it completes
        this.addHook("ActivityOrgasmStart", 1, (args, next) => {
            const character = args[0] as Character | undefined;
            if (character?.IsPlayer() && !ActivityOrgasmRuined
                && this.getSetting<boolean>("orgasmCost") !== false) {
                this.gainStat("water", ORGASM_WATER_COST, null, true);
                this.gainStat("sleep", ORGASM_SLEEP_COST, null, true);
            }
            return next(args);
        });
    }

    private onChatMessage(data: ServerChatRoomMessage): void {
        if (data?.Type !== "Activity" || !this.isPet()) {
            return;
        }
        const me = Player.MemberNumber;
        const source = chatDictAttr(data, "SourceCharacter");
        const target = chatDictAttr(data, "TargetCharacter");

        // Sex pet: the partner finishing shortly after being gone down on
        if (typeof data.Content === "string" && /^Orgasm\d/.test(data.Content)
            && typeof source === "number" && source !== me) {
            this.onPartnerOrgasm(source);
            return;
        }

        const activity = String(chatDictAttr(data, "ActivityName") ?? "");
        if (!activity) {
            return;
        }
        const focusGroup = String(chatDictAttr(data, "FocusGroupName") ?? "");
        const sourceChar = typeof source === "number" ? this.findInRoom(source) : null;

        // Eating and drinking: anything used on this pet's mouth (fed by
        // someone, self-fed, or one of the bowl activities)
        if (target === me && focusGroup === "ItemMouth") {
            const bowl = activity === BCP_BOWL_EAT || activity === BCP_BOWL_DRINK || activity.startsWith("MPA_Bowl");
            const amount = bowl ? BOWL_RECOVERY : ITEM_RECOVERY;
            if (this.isFoodActivity(activity)) {
                this.gainStat("food", amount, sourceChar);
            }
            if (this.isWaterActivity(activity)) {
                this.gainStat("water", amount, sourceChar);
            }
        }

        // Eating out of someone's hand (the pet performs the activity there)
        if (source === me && target !== me && focusGroup === "ItemHands" && this.isFoodActivity(activity)) {
            this.gainStat("food", ITEM_RECOVERY, typeof target === "number" ? this.findInRoom(target) : null);
        }

        // Affection from being touched
        if (target === me && source !== me) {
            const zone = AFFECTION_ZONE_WEIGHT[focusGroup] ?? 1;
            if (AFFECTION_LOVE_ACTIVITIES.includes(activity)) {
                this.gainStat("affection", AFFECTION_LOVE_GAIN * zone, sourceChar);
            } else if (AFFECTION_LIKE_ACTIVITIES.includes(activity)) {
                this.gainStat("affection", AFFECTION_LIKE_GAIN * zone, sourceChar);
            } else if (AFFECTION_ROUGH_ACTIVITIES.includes(activity)) {
                const flip = this.getSetting<boolean>("masochist") === true ? -1 : 1;
                this.gainStat("affection", AFFECTION_ROUGH_LOSS * zone * flip, sourceChar);
            }
        }

        // Sex pet: performing oral on someone
        if (source === me && typeof target === "number" && target !== me
            && this.sexPetGain() > 0
            && SEX_PET_ORAL_ACTIVITIES.includes(activity) && SEX_PET_REGIONS.includes(focusGroup)) {
            this.gainStat("food", this.sexPetGain(), this.findInRoom(target));
            this.oralAt.set(target, Date.now());
        }
    }

    private isFoodActivity(name: string): boolean {
        return name === BCP_BOWL_EAT || FOOD_ACTIVITY_NAMES.includes(name)
            || this.activityHasPrerequisite(name, "Needs-EatItem");
    }

    private isWaterActivity(name: string): boolean {
        return name === BCP_BOWL_DRINK || WATER_ACTIVITY_NAMES.includes(name)
            || this.activityHasPrerequisite(name, "Needs-SipItem");
    }

    private activityHasPrerequisite(name: string, prerequisite: string): boolean {
        const activity = ActivityFemale3DCG.find((a) => (a.Name as string) === name);
        return activity?.Prerequisite?.includes(prerequisite as ActivityPrerequisite) ?? false;
    }

    private sexPetGain(): number {
        return SEX_PET_GAIN[this.getSetting<string>("sexPet")] ?? 0;
    }

    private onPartnerOrgasm(partner: number): void {
        const gain = this.sexPetGain();
        const oral = this.oralAt.get(partner);
        if (gain <= 0 || oral === undefined || Date.now() - oral > SEX_PET_ORGASM_WINDOW_MS) {
            return;
        }
        this.oralAt.delete(partner);
        const partnerChar = this.findInRoom(partner);
        this.gainStat("water", gain * SEX_PET_THIRST_MULTIPLIER, partnerChar);
        if (partnerChar) {
            SendAction(`${CharacterNickname(Player)} eagerly drinks down everything ${CharacterNickname(partnerChar)} gives.`);
        }
    }

    private findInRoom(memberNumber: number): Character | null {
        return (ChatRoomCharacter ?? []).find((c) => c.MemberNumber === memberNumber) ?? null;
    }

    // ------------------------------------------------------- Bowl activities

    private installBowlActivities(): void {
        // MPA registers its own bowl activities; a second pair of identical
        // buttons helps nobody - MPA's messages feed our stats regardless
        if (this.mpaPresent) {
            debug("MPA detected - using its pet bowl activities instead of registering our own");
            return;
        }
        const hasBowl = (acting: Character): boolean => {
            try {
                return InventoryGet(acting, "ItemDevices")?.Asset.Name === "PetBowl" && !acting.IsMouthBlocked();
            } catch {
                return false;
            }
        };
        this.activities.register([
            {
                name: BCP_BOWL_EAT,
                label: "Eat From Bowl",
                selfGroups: ["ItemMouth"],
                actionSelf: "SourceCharacter eats from PronounPossessive pet bowl.",
                image: "Assets/Female3DCG/ItemDevices/Preview/PetBowl.png",
                customPrerequisite: { name: "BCPHasPetBowl", check: hasBowl },
            },
            {
                name: BCP_BOWL_DRINK,
                label: "Drink From Bowl",
                selfGroups: ["ItemMouth"],
                actionSelf: "SourceCharacter drinks from PronounPossessive pet bowl.",
                image: "Assets/Female3DCG/ItemDevices/Preview/PetBowl.png",
                customPrerequisite: { name: "BCPHasPetBowl", check: hasBowl },
            },
        ]);

        this.addHook("ActivityCheckPrerequisite", 1, (args, next) => {
            const [prerequisite, acting] = args;
            const result = this.activities.handlePrerequisite(prerequisite as string, acting as Character);
            return result === null ? next(args) : result;
        });

        // Outgoing custom-activity messages carry their rendered text as a
        // fallback, so people without BC+ still see a proper action line
        this.addHook("ServerSend", 1, (args, next) => {
            const [message, data] = args as [string, ServerChatRoomMessage | undefined];
            if (message === "ChatRoomChat" && data?.Type === "Activity"
                && String(chatDictAttr(data, "ActivityName") ?? "").startsWith(BCP_ACTIVITY_PREFIX)) {
                this.activities.appendFallbackText(data as { Content?: string; Dictionary?: unknown[] });
            }
            return next(args);
        });

        this.addHook("ElementButton.CreateForActivity", 1, (args, next) => {
            try {
                const raw = args as unknown as unknown[];
                const item = raw[1] as { Activity?: { Name?: string } } | undefined;
                const image = item?.Activity?.Name ? this.activities.imageFor(item.Activity.Name) : undefined;
                if (image) {
                    const options = (raw[4] ?? {}) as Record<string, unknown>;
                    options.image = image;
                    raw[4] = options;
                }
            } catch {
                // Never break BC's activity buttons over an icon
            }
            return next(args);
        });
    }

    // ------------------------------------------------------------- Offline

    /**
     * Login catch-up: time between the baseline stamp and the last-seen stamp
     * was online play and drains fully; time after last-seen was offline and
     * follows the offline setting (pause, or drain down to the floor). A pet
     * that was switched off (paused) just resumes where it stood.
     */
    private applyOfflineElapsed(): void {
        const now = Date.now();
        if (this.Data.levels === null || typeof this.Data.levels !== "object") {
            this.Data.levels = Object.fromEntries(PET_STATS.map((s) => [s.id, 100]));
            this.Data.stampedAt = now;
            this.Data.paused = false;
            return;
        }
        if (this.Data.paused === true || !this.isPet()) {
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

    /**
     * Own rings only - other pets' rings are drawn by Core from their
     * broadcast mirror, so watching pets never requires this module.
     */
    private drawHud(C: Character, CharX: number, CharY: number, Zoom: number): void {
        if (!C.IsPlayer() || !this.isPet() || this.getSetting<boolean>("hudSelf") === false) {
            return;
        }
        const levels = this.currentLevels();
        drawPetRings(
            this.activeStats().map((stat) => ({ label: stat.label, color: stat.color, level: levels[stat.id] })),
            CharX, CharY, Zoom,
            { raise: this.mpaPresent, showNumbers: this.getSetting<boolean>("hudNumbers") === true },
        );
    }
}
