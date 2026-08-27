import { RuleDefinition } from "@/system/rules/RuleTypes";

/**
 * Forced BC settings: each rule pins one base-game preference to a configured
 * value. Enforcement is a revert loop (like Control-nickname): the setting
 * snaps back within seconds of being changed, whatever UI changed it. With
 * "restore" on, the pre-rule value is snapshotted (persisted, so it survives
 * relog) and put back when the rule stops applying - conditions ending,
 * un-enforcing, or deactivation.
 */

const SETTING_CHECK_MS = 2500;

/** Pushes every settings group these rules touch to the server (mirrors BC's preference save). */
function preferenceSync(): void {
    ServerAccountUpdate.QueueData({
        ArousalSettings: Player.ArousalSettings,
        GameplaySettings: Player.GameplaySettings,
        ImmersionSettings: Player.ImmersionSettings,
        OnlineSettings: Player.OnlineSettings,
        OnlineSharedSettings: Player.OnlineSharedSettings,
        GraphicsSettings: Player.GraphicsSettings,
        AllowedInteractions: Player.AllowedInteractions,
    });
}

/** Label<->value choices per setting rule id, for the BCX migration translator. */
export const SETTING_RULE_CHOICES: Record<string, readonly { label: string; value: unknown }[]> = {};

interface ForcedSettingSpec<T> {
    id: string;
    /** The BC setting's name as the player knows it (rule shows as "Force '<name>'") */
    setting: string;
    description: string;
    bcxEquivalent?: string;
    /** Picker labels mapped to the BC value they force */
    choices: readonly { label: string; value: T }[];
    defaultChoice: string;
    /** Current value; undefined = settings group unavailable (rule waits) */
    get(): T | undefined;
    set(value: T): void;
}

function forcedSettingRule<T>(spec: ForcedSettingSpec<T>): RuleDefinition {
    SETTING_RULE_CHOICES[spec.id] = spec.choices;
    return {
        id: spec.id,
        name: `Force '${spec.setting}'`,
        description: `${spec.description} While enforced, the '${spec.setting}' setting is held `
            + "at the configured value - changes snap back within seconds. With the restore "
            + "option on, the value from before the rule took hold returns when the rule stops "
            + "applying.",
        category: "Settings",
        bcxEquivalent: spec.bcxEquivalent,
        // No announce texts: a revert loop in chat would be spam - corrections
        // are logged (when logging is on) and otherwise silent
        settings: [
            {
                type: "option",
                name: "value",
                label: "Forced value",
                options: spec.choices.map((c) => c.label),
                default: spec.defaultChoice,
            },
            {
                type: "checkbox",
                name: "restore",
                label: "Restore the previous value when the rule ends",
                default: true,
            },
        ],
        load(ctx) {
            // Whether the pin currently holds (in-memory; the snapshot itself
            // is persisted internal state so relog cannot lose the original)
            let applied = false;
            const restore = (): void => {
                applied = false;
                // The persisted snapshot is the authority on whether there is
                // anything to undo - after a relog `applied` starts false
                // while the BC setting is still pinned, so gating on it left
                // the pin stuck (and the stale snapshot could later clobber a
                // manual change)
                const previous = ctx.getInternal<T>("previous");
                if (previous === undefined) {
                    return;
                }
                if (ctx.setting<boolean>("restore") && spec.get() !== undefined) {
                    spec.set(previous);
                    preferenceSync();
                }
                ctx.setInternal("previous", undefined);
            };
            ctx.cleanup(restore);
            ctx.interval(() => {
                if (typeof Player === "undefined" || !Player.MemberNumber || !ServerIsConnected) {
                    return;
                }
                if (!ctx.isEnforced()) {
                    restore();
                    return;
                }
                const wanted = spec.choices.find((c) => c.label === ctx.setting<string>("value"))?.value;
                const current = spec.get();
                if (wanted === undefined || current === undefined) {
                    return;
                }
                if (!applied) {
                    applied = true;
                    // Keep an existing snapshot (e.g. from before a relog) -
                    // the current value would already be the forced one
                    if (ctx.getInternal("previous") === undefined) {
                        ctx.setInternal("previous", current);
                    }
                }
                if (current !== wanted) {
                    spec.set(wanted);
                    preferenceSync();
                    ctx.trigger();
                }
            }, SETTING_CHECK_MS);
        },
    };
}

const TOGGLE = (on: string, off: string): readonly { label: string; value: boolean }[] => [
    { label: on, value: true },
    { label: off, value: false },
];

// --- General ---

export const ForceItemPermission = forcedSettingRule<AllowedInteractions>({
    id: "settings.itemPermission",
    setting: "Item permission",
    description: "Pins who is allowed to use items on the player.",
    bcxEquivalent: "setting_item_permission",
    choices: [
        { label: "Everyone, no exceptions", value: 0 },
        { label: "Everyone, except blacklist", value: 1 },
        { label: "Owner, Lovers, whitelist & Dominants", value: 2 },
        { label: "Owner, Lovers and whitelist only", value: 3 },
        { label: "Owner and Lovers only", value: 4 },
        { label: "Owner only", value: 5 },
    ],
    defaultChoice: "Everyone, no exceptions",
    get: () => Player.AllowedInteractions,
    set: (value) => {
        Player.AllowedInteractions = value;
    },
});

export const ForceLockpickingSelf = forcedSettingRule<boolean>({
    id: "settings.lockpickingSelf",
    setting: "Locks on you can't be picked",
    description: "Pins whether locks on the player can be picked at all.",
    bcxEquivalent: "setting_forbid_lockpicking",
    choices: TOGGLE("Locks cannot be picked", "Locks can be picked"),
    defaultChoice: "Locks cannot be picked",
    get: () => Player.OnlineSharedSettings?.DisablePickingLocksOnSelf,
    set: (value) => {
        Player.OnlineSharedSettings.DisablePickingLocksOnSelf = value;
    },
});

export const ForceSPRoomLock = forcedSettingRule<boolean>({
    id: "settings.spRooms",
    setting: "Cannot enter single-player rooms when restrained",
    description: "Pins whether being restrained blocks entering single-player rooms.",
    bcxEquivalent: "setting_forbid_SP_rooms",
    choices: TOGGLE("Blocked while restrained", "Always allowed"),
    defaultChoice: "Blocked while restrained",
    get: () => Player.GameplaySettings?.OfflineLockedRestrained,
    set: (value) => {
        Player.GameplaySettings.OfflineLockedRestrained = value;
    },
});

export const ForceSafewordSetting = forcedSettingRule<boolean>({
    id: "settings.safeword",
    setting: "Allow safeword use",
    description: "Pins BC's safeword setting. Forcing it off removes the player's in-game "
        + "safeword release - use with care and consent.",
    bcxEquivalent: "setting_forbid_safeword",
    choices: TOGGLE("Safeword allowed", "Safeword disabled"),
    defaultChoice: "Safeword disabled",
    get: () => Player.GameplaySettings?.EnableSafeword,
    set: (value) => {
        Player.GameplaySettings.EnableSafeword = value;
    },
});

// --- Arousal ---

export const ForceArousalMeter = forcedSettingRule<string>({
    id: "settings.arousalMeter",
    setting: "Arousal meter",
    description: "Pins the arousal meter's activation mode.",
    bcxEquivalent: "setting_arousal_meter",
    choices: [
        { label: "Disable sexual activities", value: "Inactive" },
        { label: "Allow without a meter", value: "NoMeter" },
        { label: "Allow with a manual meter", value: "Manual" },
        { label: "Allow with a hybrid meter", value: "Hybrid" },
        { label: "Allow with a locked meter", value: "Automatic" },
    ],
    defaultChoice: "Allow with a hybrid meter",
    get: () => Player.ArousalSettings?.Active,
    set: (value) => {
        Player.ArousalSettings!.Active = value as typeof Player.ArousalSettings.Active;
    },
});

export const ForceArousalStutter = forcedSettingRule<string>({
    id: "settings.arousalStutter",
    setting: "Arousal speech stuttering",
    description: "Pins when arousal makes the player's speech stutter.",
    bcxEquivalent: "setting_arousal_stutter",
    choices: [
        { label: "Never stutter", value: "None" },
        { label: "When aroused", value: "Arousal" },
        { label: "When vibrated", value: "Vibration" },
        { label: "Aroused & vibrated", value: "All" },
    ],
    defaultChoice: "Aroused & vibrated",
    get: () => Player.ArousalSettings?.AffectStutter,
    set: (value) => {
        Player.ArousalSettings!.AffectStutter = value as typeof Player.ArousalSettings.AffectStutter;
    },
});

export const ForceVibeModes = forcedSettingRule<boolean>({
    id: "settings.vibeModes",
    setting: "Block advanced vibrator modes",
    description: "Pins whether advanced (escalating/random/edging) vibrator modes work on the player.",
    bcxEquivalent: "setting_block_vibe_modes",
    choices: TOGGLE("Advanced modes blocked", "Advanced modes allowed"),
    defaultChoice: "Advanced modes allowed",
    get: () => Player.ArousalSettings?.DisableAdvancedVibes,
    set: (value) => {
        Player.ArousalSettings!.DisableAdvancedVibes = value;
    },
});

// --- Online ---

export const ForceAfkBubble = forcedSettingRule<boolean>({
    id: "settings.afkBubble",
    setting: "Show AFK bubble",
    description: "Pins whether the player shows the automatic AFK bubble when idle.",
    bcxEquivalent: "setting_show_afk",
    choices: TOGGLE("AFK bubble shown", "AFK bubble hidden"),
    defaultChoice: "AFK bubble shown",
    get: () => Player.OnlineSettings?.EnableAfkTimer,
    set: (value) => {
        Player.OnlineSettings!.EnableAfkTimer = value;
    },
});

export const ForceBodyModAccess = forcedSettingRule<boolean>({
    id: "settings.bodyMod",
    setting: "Allow others to alter your whole appearance",
    description: "Pins whether people with wardrobe access may change the player's whole "
        + "appearance including body parts.",
    bcxEquivalent: "setting_allow_body_mod",
    choices: TOGGLE("Full appearance access", "Body is off-limits"),
    defaultChoice: "Full appearance access",
    get: () => Player.OnlineSharedSettings?.AllowFullWardrobeAccess,
    set: (value) => {
        Player.OnlineSharedSettings.AllowFullWardrobeAccess = value;
    },
});

export const ForceCosplayLock = forcedSettingRule<boolean>({
    id: "settings.cosplayChange",
    setting: "Prevent others from changing cosplay items",
    description: "Pins whether others may change the player's cosplay items (ears, tails, wings).",
    bcxEquivalent: "setting_forbid_cosplay_change",
    choices: TOGGLE("Cosplay items protected", "Cosplay items changeable"),
    defaultChoice: "Cosplay items changeable",
    get: () => Player.OnlineSharedSettings?.BlockBodyCosplay,
    set: (value) => {
        Player.OnlineSharedSettings.BlockBodyCosplay = value;
    },
});

// --- Immersion ---

export const ForceSensDepSetting = forcedSettingRule<string>({
    id: "settings.sensdep",
    setting: "Sensory deprivation setting",
    description: "Pins how strongly blindness items affect the player.",
    bcxEquivalent: "setting_sensdep",
    choices: [
        { label: "Light", value: "SensDepLight" },
        { label: "Normal", value: "Normal" },
        { label: "Hide names", value: "SensDepNames" },
        { label: "Heavy", value: "SensDepTotal" },
        { label: "Total", value: "SensDepExtreme" },
    ],
    defaultChoice: "Normal",
    get: () => Player.GameplaySettings?.SensDepChatLog,
    set: (value) => {
        Player.GameplaySettings.SensDepChatLog = value as typeof Player.GameplaySettings.SensDepChatLog;
    },
});

export const ForceHideNonAdjacent = forcedSettingRule<boolean>({
    id: "settings.hideNonAdjacent",
    setting: "Hide non-adjacent players while partially blind",
    description: "Pins whether partial blindness hides everyone not standing next to the player.",
    bcxEquivalent: "setting_hide_non_adjecent",
    choices: TOGGLE("Hidden while blind", "Always visible"),
    defaultChoice: "Hidden while blind",
    get: () => Player.ImmersionSettings?.BlindAdjacent,
    set: (value) => {
        Player.ImmersionSettings!.BlindAdjacent = value;
    },
});

export const ForceBlindRoomGarbling = forcedSettingRule<boolean>({
    id: "settings.blindRoomGarbling",
    setting: "Garble chatroom names and descriptions while blind",
    description: "Pins whether room names and descriptions garble while the player is blind.",
    bcxEquivalent: "setting_blind_room_garbling",
    choices: TOGGLE("Garbled while blind", "Always readable"),
    defaultChoice: "Garbled while blind",
    get: () => Player.ImmersionSettings?.ChatRoomMuffle,
    set: (value) => {
        Player.ImmersionSettings!.ChatRoomMuffle = value;
    },
});

export const ForceRelogRestraints = forcedSettingRule<boolean>({
    id: "settings.relogKeepsRestraints",
    setting: "Keep all restraints when relogging",
    description: "Pins whether restraints stay on through a relog.",
    bcxEquivalent: "setting_relog_keeps_restraints",
    choices: TOGGLE("Restraints kept", "Restraints removed"),
    defaultChoice: "Restraints kept",
    get: () => Player.GameplaySettings?.DisableAutoRemoveLogin,
    set: (value) => {
        Player.GameplaySettings.DisableAutoRemoveLogin = value;
    },
});

export const ForceLeashedRoomChange = forcedSettingRule<boolean>({
    id: "settings.leashedRoomChange",
    setting: "Players can drag you to rooms when leashed",
    description: "Pins whether leash holders can drag the player between rooms.",
    bcxEquivalent: "setting_leashed_roomchange",
    choices: TOGGLE("Dragging allowed", "Dragging blocked"),
    defaultChoice: "Dragging allowed",
    get: () => Player.OnlineSharedSettings?.AllowPlayerLeashing,
    set: (value) => {
        Player.OnlineSharedSettings.AllowPlayerLeashing = value;
    },
});

export const ForceRoomRejoin = forcedSettingRule<boolean>({
    id: "settings.roomRejoin",
    setting: "Return to chatrooms on relog",
    description: "Pins whether the player returns to the room they were in when they relog.",
    bcxEquivalent: "setting_room_rejoin",
    choices: TOGGLE("Returns to the room", "Starts in the main hall"),
    defaultChoice: "Returns to the room",
    get: () => Player.ImmersionSettings?.ReturnToChatRoom,
    set: (value) => {
        Player.ImmersionSettings!.ReturnToChatRoom = value;
    },
});

export const ForcePlugVibeEvents = forcedSettingRule<boolean>({
    id: "settings.plugVibeEvents",
    setting: "Events while plugged or vibed",
    description: "Pins whether worn plugs and vibrators cause random immersive chat events.",
    bcxEquivalent: "setting_plug_vibe_events",
    choices: TOGGLE("Events enabled", "Events disabled"),
    defaultChoice: "Events enabled",
    get: () => Player.ImmersionSettings?.StimulationEvents,
    set: (value) => {
        Player.ImmersionSettings!.StimulationEvents = value;
    },
});

export const ForceTintEffects = forcedSettingRule<boolean>({
    id: "settings.tintEffects",
    setting: "Allow item tint effects",
    description: "Pins whether items may tint the player's vision (colored hoods etc.).",
    bcxEquivalent: "setting_allow_tint_effects",
    choices: TOGGLE("Tints allowed", "Tints disabled"),
    defaultChoice: "Tints allowed",
    get: () => Player.ImmersionSettings?.AllowTints,
    set: (value) => {
        Player.ImmersionSettings!.AllowTints = value;
    },
});

// --- Graphics ---

export const ForceBlurEffects = forcedSettingRule<boolean>({
    id: "settings.blurEffects",
    setting: "Allow item blur effects",
    description: "Pins whether items may blur the player's vision.",
    bcxEquivalent: "setting_allow_blur_effects",
    choices: TOGGLE("Blur allowed", "Blur disabled"),
    defaultChoice: "Blur allowed",
    get: () => Player.GraphicsSettings?.AllowBlur,
    set: (value) => {
        Player.GraphicsSettings!.AllowBlur = value;
    },
});

export const ForceUpsideDownView = forcedSettingRule<boolean>({
    id: "settings.upsideDownView",
    setting: "Flip room vertically when upside-down",
    description: "Pins whether hanging upside-down flips the player's view of the room.",
    bcxEquivalent: "setting_upsidedown_view",
    choices: TOGGLE("View flips", "View stays upright"),
    defaultChoice: "View flips",
    get: () => Player.GraphicsSettings?.InvertRoom,
    set: (value) => {
        Player.GraphicsSettings!.InvertRoom = value;
    },
});

export const SETTING_RULES: readonly RuleDefinition[] = [
    ForceItemPermission,
    ForceLockpickingSelf,
    ForceSPRoomLock,
    ForceSafewordSetting,
    ForceArousalMeter,
    ForceArousalStutter,
    ForceVibeModes,
    ForceAfkBubble,
    ForceBodyModAccess,
    ForceCosplayLock,
    ForceSensDepSetting,
    ForceHideNonAdjacent,
    ForceBlindRoomGarbling,
    ForceRelogRestraints,
    ForceLeashedRoomChange,
    ForceRoomRejoin,
    ForcePlugVibeEvents,
    ForceTintEffects,
    ForceBlurEffects,
    ForceUpsideDownView,
];
