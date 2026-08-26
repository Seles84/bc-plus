import menuIcon from "@/assets/icons/pet.png";
import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig, PermissionDefinition } from "@/system/module/ModuleTypes";
import { BCPLUS_AUTHOR, BCPLUS_STORAGE, BCPLUS_VERSION } from "@/system/Constants";
import { Role } from "@/system/Roles";
import { AnySetting } from "@/system/gui/Settings";
import {
    AFFECTION_LIKE_ACTIVITIES, AFFECTION_LIKE_GAIN, AFFECTION_LOVE_ACTIVITIES, AFFECTION_LOVE_GAIN,
    AFFECTION_ROUGH_ACTIVITIES, AFFECTION_ROUGH_LOSS, AFFECTION_SKILLS, AFFECTION_ZONE_WEIGHT,
    BCP_BOWL_DRINK, BCP_BOWL_EAT, BCP_JINGLE_BELL, BELL_JINGLE_CHANCE, BELL_JINGLE_OPTIONS,
    BOWL_RECOVERY, DRAIN_CHOICES, FOOD_ACTIVITY_NAMES,
    HUNGER_THRESHOLD_CHOICES, ITEM_RECOVERY, MOVEMENT_VERBS,
    OFFLINE_FLOOR_CHOICES, OFFLINE_MODES, OFFLINE_MODE_DRAIN, ORGASM_SLEEP_COST, ORGASM_WATER_COST,
    PASSOUT_MUMBLES, PASSOUT_WAKE_LEVEL, PET_STATS, PetLevels, PetStatId,
    SEX_PET_GAIN, SEX_PET_MODES, SEX_PET_ORAL_ACTIVITIES,
    SEX_PET_ORGASM_WINDOW_MS, SEX_PET_REGIONS, SEX_PET_THIRST_MULTIPLIER, SKILL_MOD_INTERVAL_MS,
    SLOW_LEAVE_MAX_EXTRA_SEC, TINT_THRESHOLD_CHOICES, WATER_ACTIVITY_NAMES,
    chatDictAttr, clampLevel, coarseLevel, drainHoursValue, drainedLevel, offlineFloorValue,
    isSleepingLook, parchSpeech, percentValue, sleepFactor, wornBellCount,
} from "@/system/pet/PetTypes";
import { playClicks, playJingle } from "@/system/pet/PetSounds";
import { containsWord, spokenText, transformSpoken } from "@/rules/speechUtils";
import { stringListValue } from "@/system/gui/Settings";
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

    /** Effects state: knocked out until sleep recovers. */
    private passedOut = false;
    private effectsTimer: ReturnType<typeof setInterval> | null = null;
    private lastSkillApply = 0;

    protected readonly SystemConfig: ModuleConfig = {
        Name: "Pet",
        Version: BCPLUS_VERSION,
        Author: BCPLUS_AUTHOR,
        Description: "Virtual pet needs: food, water, sleep and affection",
        Active: true,
        Icon: menuIcon,
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
        return [
            {
                id: "pet.edit",
                label: "Change my pet settings",
                defaultRole: Role.Owner,
                defaultSelf: true,
            },
            {
                id: "pet.train",
                label: "Click-train me (whose clicks I hear)",
                defaultRole: Role.Mistress,
                defaultSelf: false,
            },
        ];
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
                category: "Being a pet",
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
                category: "Being a pet",
                label: "Show your pet stats under your character",
                hoverText: "Draws a small ring per need at your character's feet in chat rooms. "
                    + "Hover a ring for the exact value.",
                default: true,
            },
            {
                type: "checkbox",
                name: "hudNumbers",
                category: "Being a pet",
                label: "Show exact percentages on the stat rings",
                default: false,
            },
            {
                type: "checkbox",
                name: "shareStats",
                category: "Being a pet",
                label: "Share your pet stats with the room",
                hoverText: "Broadcasts your levels (rounded, a few times an hour) to BC+ users "
                    + "in the room so they can see your rings. Off, your stats stay entirely "
                    + "on your side.",
                default: true,
            },
            {
                type: "checkbox",
                name: "orgasmCost",
                category: "Being a pet",
                label: "Orgasms cost hydration and energy",
                hoverText: "Climaxing takes a bite out of your water and sleep levels.",
                default: true,
            },
            {
                type: "checkbox",
                name: "masochist",
                category: "Being a pet",
                label: "Masochist: rough treatment raises affection",
                hoverText: "Spanks, slaps, bites and shocks gain affection instead of losing it.",
                default: false,
            },
            {
                type: "option",
                name: "sexPet",
                category: "Being a pet",
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
                category: "Needs & drain",
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
                category: "Needs & drain",
                label: "While logged out",
                hoverText: "Whether your needs keep draining while you are not in the club. "
                    + "Draining is softened by the floor setting below.",
                options: [...OFFLINE_MODES],
                default: OFFLINE_MODE_DRAIN,
            },
            {
                type: "option",
                name: "offlineFloor",
                category: "Needs & drain",
                label: "Offline drain stops at",
                hoverText: "Time spent logged out never pulls a stat below this level "
                    + "(a stat already below it just stays where it was).",
                options: OFFLINE_FLOOR_CHOICES.map((c) => c.label),
                default: "20%",
            },
            // Page 3: effects of low stats
            {
                type: "checkbox",
                name: "effects",
                category: "Low-stat effects",
                label: "Enable pet effects (low stats have consequences)",
                hoverText: "The master switch for everything below: exhaustion darkens your "
                    + "vision and knocks you out, hunger dulls your hearing and slows your "
                    + "leaving, affection buffs or debuffs your skills. Each effect can be "
                    + "switched off individually.",
                default: false,
            },
            {
                type: "checkbox",
                name: "fxTint",
                category: "Low-stat effects",
                label: "Vision darkens as you get sleepy",
                default: true,
            },
            {
                type: "option",
                name: "fxTintAt",
                category: "Low-stat effects",
                label: "Vision starts darkening below",
                options: [...TINT_THRESHOLD_CHOICES],
                default: "25%",
            },
            {
                type: "checkbox",
                name: "fxPassout",
                category: "Low-stat effects",
                label: "Pass out when exhausted",
                hoverText: "Sleep hitting empty knocks you out: eyes forced closed, kneeling, "
                    + "unable to talk, walk or interact, deaf and mostly blind - chat comes out "
                    + "as sleepy mumbles. The forced nap recovers sleep on its own; you wake at "
                    + "10%. /bcp commands keep working throughout.",
                default: true,
            },
            {
                type: "checkbox",
                name: "fxDeaf",
                category: "Low-stat effects",
                label: "Hearing fades when hungry",
                default: true,
            },
            {
                type: "option",
                name: "fxDeafAt",
                category: "Low-stat effects",
                label: "Hearing starts fading below",
                options: [...HUNGER_THRESHOLD_CHOICES],
                default: "30%",
            },
            {
                type: "checkbox",
                name: "fxSlowLeave",
                category: "Low-stat effects",
                label: "Slow to leave the room when hungry",
                hoverText: "A starving pet takes up to 25 extra seconds to leave a chat room "
                    + "and counts as slow (easy to catch).",
                default: true,
            },
            {
                type: "option",
                name: "fxSlowAt",
                category: "Low-stat effects",
                label: "Leaving slows below",
                options: [...HUNGER_THRESHOLD_CHOICES],
                default: "30%",
            },
            {
                type: "checkbox",
                name: "fxSkillBuffs",
                category: "Low-stat effects",
                label: "High affection buffs skills",
                hoverText: "A well-loved pet gains up to +5 Self bondage and Willpower - but "
                    + "the pet-brain costs up to -5 Bondage, Evasion and Lockpicking (with "
                    + "debuffs enabled below).",
                default: true,
            },
            {
                type: "checkbox",
                name: "fxSkillDebuffs",
                category: "Low-stat effects",
                label: "Low affection debuffs skills",
                hoverText: "A neglected pet loses up to -5 Self bondage and Willpower; the "
                    + "sharpened survival instinct grants up to +5 Bondage, Evasion and "
                    + "Lockpicking (with buffs enabled above).",
                default: true,
            },
            {
                type: "checkbox",
                name: "fxHungryAffection",
                category: "Low-stat effects",
                label: "Hunger and thirst dampen affection gains",
                hoverText: "Petting counts less on an empty stomach: affection gains scale "
                    + "with your food and water levels.",
                default: true,
            },
            {
                type: "checkbox",
                name: "fxThirst",
                category: "Low-stat effects",
                label: "Speech dries up when thirsty",
                hoverText: "A parched throat cracks your words with pauses and stutters, "
                    + "getting worse as water approaches empty. OOC text is never touched.",
                default: true,
            },
            {
                type: "option",
                name: "fxThirstAt",
                category: "Low-stat effects",
                label: "Speech starts cracking below",
                options: [...HUNGER_THRESHOLD_CHOICES],
                default: "30%",
            },
            // Page 4: training sounds
            {
                type: "checkbox",
                name: "clicker",
                category: "Clicker & bells",
                label: "Clicker training: hear your trigger clicks",
                hoverText: "When someone permitted to click-train you (Authority page) sends "
                    + "a message containing one of your trigger phrases, you hear a clicker "
                    + "snap - repeated triggers click up to three times. The sound is "
                    + "synthesized locally; nothing is sent anywhere.",
                default: false,
            },
            {
                type: "stringList",
                name: "clickerTriggers",
                category: "Clicker & bells",
                label: "Clicker trigger phrases:",
                default: ["*click*"],
                maxChars: 32,
                maxEntries: 10,
                entryLabel: "trigger",
            },
            {
                type: "checkbox",
                name: "clickerEmotes",
                category: "Clicker & bells",
                label: "Emotes can trigger the clicker too",
                default: true,
            },
            {
                type: "checkbox",
                name: "clickerSelf",
                category: "Clicker & bells",
                label: "Your own messages can click",
                default: false,
            },
            {
                type: "checkbox",
                name: "clickerReward",
                category: "Clicker & bells",
                label: "A click gives a drop of affection",
                default: true,
            },
            {
                type: "option",
                name: "bellJingle",
                category: "Clicker & bells",
                label: "Worn bells jingle on movement",
                hoverText: "Moving on the map, changing pose or moving in an emote can set "
                    + "any worn bell items ringing (collar bells, nipple bells, ...). The "
                    + "chance scales with how many you wear. There is also a \"Jingle Bell\" "
                    + "activity on your neck while wearing one - its ring is heard by every "
                    + "BC+ user in the room.",
                options: [...BELL_JINGLE_OPTIONS],
                default: "Off",
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
        this.installActivities();
        this.installEffects();
        this.installTraining();
        this.effectsTimer = setInterval(() => this.effectsTick(), 2_000);
    }

    override Unload(): void {
        if (this.onlineStampTimer !== null) {
            clearInterval(this.onlineStampTimer);
            this.onlineStampTimer = null;
        }
        if (this.effectsTimer !== null) {
            clearInterval(this.effectsTimer);
            this.effectsTimer = null;
        }
        if (this.passedOut) {
            this.wakeUp(true);
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
        // Petting counts less on an empty stomach (effects option)
        if (stat === "affection" && this.effectOn("fxHungryAffection", "affection")) {
            const levels = this.currentLevels();
            const parts: number[] = [];
            if (this.statHours("food") !== null) {
                parts.push(levels.food);
            }
            if (this.statHours("water") !== null) {
                parts.push(levels.water);
            }
            if (parts.length > 0) {
                const average = parts.reduce((sum, v) => sum + v, 0) / parts.length;
                modifier *= average / 75;
            }
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

    private installActivities(): void {
        const hasBowl = (acting: Character): boolean => {
            try {
                return InventoryGet(acting, "ItemDevices")?.Asset.Name === "PetBowl" && !acting.IsMouthBlocked();
            } catch {
                return false;
            }
        };
        // MPA registers its own bowl activities; a second pair of identical
        // buttons helps nobody - MPA's messages feed our stats regardless
        if (!this.mpaPresent) {
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
        } else {
            debug("MPA detected - using its pet bowl activities instead of registering our own");
        }
        this.activities.register([{
            name: BCP_JINGLE_BELL,
            label: "Jingle Bell",
            selfGroups: ["ItemNeck"],
            actionSelf: "SourceCharacter shakes PronounPossessive bell with a bright jingle.",
            image: "Assets/Female3DCG/ItemNeckAccessories/Preview/CollarBell.png",
            customPrerequisite: { name: "BCPHasBell", check: (acting) => wornBellCount(acting) > 0 },
        }]);

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

    // ------------------------------------------------------------ Training

    private installTraining(): void {
        this.addHook("ChatRoomMessage", 1, (args, next) => {
            try {
                this.onTrainingMessage(args[0]);
            } catch {
                // Sounds are flavor; never break the chat chain
            }
            return next(args);
        });

        // Worn bells jingle on movement: map steps, pose changes, emoted moves
        this.addHook("ChatRoomMapViewUpdatePlayerFlag", 1, (args, next) => {
            const result = next(args);
            this.maybeJingle(true);
            return result;
        });
        this.addHook("PoseRefresh", 1, (args, next) => {
            const character = args[0] as Character | undefined;
            const before = character?.IsPlayer() ? JSON.stringify(Player.PoseMapping ?? {}) : null;
            const result = next(args);
            if (before !== null && before !== JSON.stringify(Player.PoseMapping ?? {})) {
                this.maybeJingle(true);
            }
            return result;
        });
    }

    private onTrainingMessage(data: ServerChatRoomMessage): void {
        // The Jingle Bell activity rings for every BC+ user in the room
        if (data?.Type === "Activity" && String(chatDictAttr(data, "ActivityName") ?? "") === BCP_JINGLE_BELL) {
            playJingle(2);
            return;
        }

        // Own emoted movement can ring worn bells (a third as likely as a step)
        if (data?.Sender === Player.MemberNumber && typeof data.Content === "string"
            && (data.Type === "Emote" || data.Type === "Action")
            && MOVEMENT_VERBS.some((verb) => containsWord(data.Content, verb))) {
            this.maybeJingle(false);
        }

        // Clicker: trigger phrases from permitted people
        if (this.getSetting<boolean>("clicker") !== true || typeof data?.Sender !== "number"
            || typeof data.Content !== "string") {
            return;
        }
        if (data.Type !== "Chat"
            && !(data.Type === "Emote" && this.getSetting<boolean>("clickerEmotes") !== false)) {
            return;
        }
        if (data.Sender === Player.MemberNumber) {
            if (this.getSetting<boolean>("clickerSelf") !== true) {
                return;
            }
        } else {
            const authority = this.ModuleManager.getModule<Authority>("authority");
            if (!(authority?.hasPermission(data.Sender, "pet.train") ?? false)) {
                return;
            }
        }
        const heard = spokenText(data.Content).toLocaleLowerCase();
        let clicks = 0;
        for (const trigger of stringListValue(this.getSetting<unknown>("clickerTriggers"))) {
            const needle = trigger.toLocaleLowerCase();
            for (let at = heard.indexOf(needle); at !== -1; at = heard.indexOf(needle, at + needle.length)) {
                clicks++;
            }
        }
        if (clicks === 0) {
            return;
        }
        playClicks(clicks);
        if (this.getSetting<boolean>("clickerReward") !== false) {
            this.gainStat("affection", Math.min(3, clicks), this.findInRoom(data.Sender));
        }
        debug(`Clicker: ${clicks} click(s) from #${data.Sender}`);
    }

    /** Rolls the movement-jingle chance against the worn bells and plays. */
    private maybeJingle(strongMove: boolean): void {
        const chance = BELL_JINGLE_CHANCE[this.getSetting<string>("bellJingle")] ?? 0;
        if (chance <= 0) {
            return;
        }
        const bells = wornBellCount(Player);
        if (bells === 0 || Math.random() > chance * bells * (strongMove ? 1 : 3)) {
            return;
        }
        playJingle(bells);
    }

    // ------------------------------------------------------------- Effects

    /** Whether MPA's own conditions run - ours then stand down entirely. */
    private mpaEffectsActive(): boolean {
        if (!this.mpaPresent) {
            return false;
        }
        try {
            const mpa = (Player as unknown as { MPA?: Record<string, Record<string, unknown> | undefined> }).MPA;
            return mpa?.["VirtualPet"]?.["enabled"] === true
                && mpa?.["VirtualPetConditions"]?.["enabled"] === true;
        } catch {
            return false;
        }
    }

    /** Whether one effect toggle is armed (master + toggle + its stat in play). */
    private effectOn(key: string, stat: PetStatId): boolean {
        return this.isPet()
            && this.getSetting<boolean>("effects") === true
            && this.getSetting<boolean>(key) !== false
            && this.statHours(stat) !== null
            && !this.mpaEffectsActive();
    }

    private threshold(key: string, fallback: number): number {
        return percentValue(this.getSetting<string>(key), fallback);
    }

    private effectsTick(): void {
        this.checkPassout();
        if (Date.now() - this.lastSkillApply >= SKILL_MOD_INTERVAL_MS) {
            this.lastSkillApply = Date.now();
            this.applySkillModifiers();
        }
    }

    // --- Passout

    private checkPassout(): void {
        if (!this.effectOn("fxPassout", "sleep")) {
            if (this.passedOut) {
                this.wakeUp(true);
            }
            return;
        }
        const sleep = this.currentLevels().sleep;
        if (!this.passedOut && sleep <= 0.5 && !this.lscgAsleep()) {
            this.passOut();
        } else if (this.passedOut && sleep >= PASSOUT_WAKE_LEVEL) {
            this.wakeUp(false);
        } else if (this.passedOut && !isSleepingLook(Player)) {
            // Someone (or the pet) opened the eyes - without the sleeping look
            // sleep stops recovering and the nap would never end
            try {
                CharacterSetFacialExpression(Player, "Emoticon", "Sleep");
                CharacterSetFacialExpression(Player, "Eyes", "Closed");
                CharacterSetFacialExpression(Player, "Eyes2", "Closed");
            } catch {
                // Best effort
            }
        }
    }

    /** Whether LSCG already has the player asleep - never pile on top. */
    private lscgAsleep(): boolean {
        try {
            const lscg = (globalThis as Record<string, unknown>)["LSCG"] as
                { getModule?: (name: string) => { SleepState?: { Active?: boolean } } | undefined } | undefined;
            return lscg?.getModule?.("StateModule")?.SleepState?.Active === true;
        } catch {
            return false;
        }
    }

    /**
     * Knocks the pet out. The forced sleeping look (closed eyes + Sleep
     * emoticon) starts sleep recovery on its own, so the nap self-heals and
     * ends at the wake level.
     */
    private passOut(): void {
        this.passedOut = true;
        try {
            SendAction(`${CharacterNickname(Player)} passes out from exhaustion.`);
            CharacterSetFacialExpression(Player, "Emoticon", "Sleep");
            CharacterSetFacialExpression(Player, "Eyes", "Closed");
            CharacterSetFacialExpression(Player, "Eyes2", "Closed");
            CharacterSetFacialExpression(Player, "Fluids", "DroolMedium");
            if (Player.CanKneel()) {
                PoseSetActive(Player, "Kneel", true);
            }
        } catch {
            // Expressions are flavor; the state itself is what matters
        }
        debug("Pet passed out from exhaustion");
    }

    private wakeUp(quiet: boolean): void {
        this.passedOut = false;
        try {
            CharacterSetFacialExpression(Player, "Emoticon", null);
            CharacterSetFacialExpression(Player, "Eyes", quiet ? null : "Dazed");
            CharacterSetFacialExpression(Player, "Eyes2", quiet ? null : "Dazed");
            if (!quiet) {
                CharacterSetFacialExpression(Player, "Eyebrows", "Lowered");
                SendAction(`${CharacterNickname(Player)} stirs and wakes up from the forced nap.`);
            }
        } catch {
            // Same rule as passOut
        }
        debug("Pet woke up");
    }

    private installEffects(): void {
        // Sleepy tint: vision fades to black as sleep approaches empty
        this.addHook("Player.GetTints", 5, (args, next) => {
            const result = next(args);
            if (!this.effectOn("fxTint", "sleep")) {
                return result;
            }
            const at = this.threshold("fxTintAt", 25);
            const sleep = this.currentLevels().sleep;
            if (at <= 0 || sleep >= at) {
                return result;
            }
            const alpha = Math.sqrt(Math.min(1, (at - sleep) / at));
            return result.concat({ r: 0, g: 0, b: 0, a: alpha });
        });

        // Passout capability blocks
        for (const capability of ["Player.CanTalk", "Player.CanWalk", "Player.CanChangeOwnClothes", "Player.CanInteract"] as const) {
            this.addHook(capability, 5, (args, next) => (this.passedOut ? false : next(args)));
        }

        // Chat while passed out becomes sleepy mumbling (OOC passes)
        this.addHook("ServerSend", 5, (args, next) => {
            const [message, data] = args as [string, ServerChatRoomMessage | undefined];
            if (this.passedOut && message === "ChatRoomChat" && data?.Type === "Chat"
                && typeof data.Content === "string" && !data.Content.startsWith("(")) {
                const mumble = PASSOUT_MUMBLES[Math.floor(Math.random() * PASSOUT_MUMBLES.length)]!;
                SendAction(`${CharacterNickname(Player)} ${mumble}`);
                return;
            }
            return next(args);
        });

        // Dry throat: thirst cracks outgoing speech (in-character text only).
        // Priority below the passout hook, whose full mumble replacement wins
        this.addHook("ServerSend", 4, (args, next) => {
            const [message, data] = args as [string, ServerChatRoomMessage | undefined];
            if (message === "ChatRoomChat" && data?.Type === "Chat"
                && typeof data.Content === "string" && this.effectOn("fxThirst", "water")) {
                const at = this.threshold("fxThirstAt", 30);
                const water = this.currentLevels().water;
                if (at > 0 && water < at) {
                    const severity = Math.min(3, 1 + Math.floor((3 * (at - water)) / at));
                    data.Content = transformSpoken(data.Content, (text) => parchSpeech(text, severity));
                }
            }
            return next(args);
        });

        // Hearing: hunger dulls it progressively; passed out = fully deaf
        this.addHook("Player.GetDeafLevel", 5, (args, next) => {
            let level = next(args);
            if (this.passedOut) {
                level = Math.max(level, 4);
            }
            if (this.effectOn("fxDeaf", "food")) {
                const at = this.threshold("fxDeafAt", 30);
                const food = this.currentLevels().food;
                if (at > 0 && food < at) {
                    // Thirds of the threshold: one step deafer per third below it
                    level = Math.max(level, Math.min(3, Math.floor((3 * (at - food)) / at)));
                }
            }
            return level;
        });

        // Passed out pets see next to nothing
        this.addHook("Player.GetBlindLevel", 5, (args, next) => {
            if (!this.passedOut) {
                return next(args);
            }
            const sensDep = Player.GameplaySettings?.SensDepChatLog;
            return (sensDep === "SensDepExtreme" || sensDep === "SensDepTotal") ? 3 : 2;
        });

        // Hungry pets are slow to leave (and count as slow, so they can be caught)
        this.addHook("ChatRoomAttemptLeave", 1, (args, next) => {
            if (!this.effectOn("fxSlowLeave", "food")) {
                return next(args);
            }
            const at = this.threshold("fxSlowAt", 30);
            const food = this.currentLevels().food;
            const previousTimer = ChatRoomSlowtimer;
            const result = next(args);
            if (previousTimer === 0 && ChatRoomSlowtimer > 0 && at > 0 && food <= at) {
                const extraMs = ((at - food) / at) * SLOW_LEAVE_MAX_EXTRA_SEC * 1000;
                ChatRoomSlowtimer = CurrentTime + ChatRoomSlowLeaveMinTime + extraMs;
            }
            return result;
        });
        this.addHook("Player.IsSlow", 1, (args, next) => {
            if (this.effectOn("fxSlowLeave", "food")
                && this.currentLevels().food <= this.threshold("fxSlowAt", 30)) {
                return true;
            }
            return next(args);
        });
    }

    /**
     * Affection maps to [-5..+5] across the pet skills: positive-correlation
     * skills get it as-is, negative ones inverted (see AFFECTION_SKILLS).
     * Buffs and debuffs are gated by their own toggles per resulting sign.
     */
    private applySkillModifiers(): void {
        if (!this.isPet() || this.getSetting<boolean>("effects") !== true
            || this.statHours("affection") === null || this.mpaEffectsActive()) {
            return;
        }
        const buffs = this.getSetting<boolean>("fxSkillBuffs") !== false;
        const debuffs = this.getSetting<boolean>("fxSkillDebuffs") !== false;
        if (!buffs && !debuffs) {
            return;
        }
        const affection = this.currentLevels().affection;
        const base = Math.round(((affection / 100) * 10 - 5) * 100) / 100;
        try {
            if (SkillModifierMax < 5) {
                SkillModifierMax = 5;
            }
            for (const [skill, sign] of AFFECTION_SKILLS) {
                const modifier = base * sign;
                if (modifier === 0 || (modifier > 0 && !buffs) || (modifier < 0 && !debuffs)) {
                    continue;
                }
                SkillSetModifier(Player, skill as SkillType, modifier, SKILL_MOD_INTERVAL_MS + 2_000, false);
            }
        } catch {
            // Skill API quirks must never break the tick
        }
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
