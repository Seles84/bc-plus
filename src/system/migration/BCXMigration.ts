import { ConditionData } from "@/system/conditions/Conditions";
import { CurseSlotData } from "@/system/curses/CurseTypes";
import { Role, RoleNames } from "@/system/Roles";
import { SETTING_RULE_CHOICES } from "@/rules/SettingRules";
import { jsonClone } from "@/utils/BCUtils";
import type Rules from "@/modules/Rules";
import type Curses from "@/modules/Curses";

/**
 * BCX -> BC+ migration: reads the player's own BCX configuration through the
 * BCX mod API (read-only - BCX state is never touched) and builds the
 * matching BC+ configuration. Thanks to tandem deferral the migrated BC+
 * rules stay paused while BCX still enforces its own, so the hand-over is
 * seamless: switch BCX's rules off (or BCX entirely) whenever ready and BC+
 * takes over instantly.
 */

export interface RuleMigrationItem {
    kind: "rule";
    bcpId: string;
    name: string;
    bcxId: string;
    /** BCX's on/off toggle for the rule - becomes the BC+ active state */
    bcxActive: boolean;
    enforce: boolean;
    log: boolean;
    conditions?: ConditionData;
    /** Translated BC+ settings; absent = defaults */
    settings?: Record<string, unknown>;
    /** BCX has configuration we could not translate - review after migrating */
    review: boolean;
    alreadyActive: boolean;
    /** Weld/contract/punishment-locked on the BC+ side - cannot be applied */
    locked: boolean;
}

export interface CurseMigrationItem {
    kind: "curse";
    group: AssetGroupName;
    label: string;
    slot: CurseSlotData;
    alreadyCursed: boolean;
}

export interface MigrationPlan {
    rules: RuleMigrationItem[];
    curses: CurseMigrationItem[];
    /** Added in BCX but with no BC+ counterpart - stays in BCX */
    unmapped: { bcxId: string; name: string }[];
}

/** BCX rules with no BC+ counterpart, for the "stays in BCX" report. */
const BCX_UNMAPPED_RULES: readonly { id: string; name: string }[] = [
    { id: "speech_specific_sound", name: "Allow specific sounds only" },
    { id: "speech_ban_words_in_emotes", name: "Forbid saying certain words in emotes" },
    { id: "speech_mandatory_words_in_emotes", name: "Establish mandatory words in emotes" },
    { id: "speech_forbid_open_talking", name: "Forbid talking openly" },
    { id: "speech_limit_open_talking", name: "Limit talking openly" },
    { id: "speech_limit_emotes", name: "Limit using emotes" },
    { id: "speech_restrict_whisper_receive", name: "Restrict receiving whispers" },
    { id: "speech_restrict_beep_receive", name: "Restrict receiving beeps" },
    { id: "speech_greet_order", name: "Order to greet club" },
    { id: "greet_new_guests", name: "Greet new guests" },
    { id: "speech_using_honorifics", name: "Using honorifics" },
    { id: "speech_force_retype", name: "Force to retype" },
    { id: "speech_partial_hearing", name: "Partial hearing" },
    { id: "speech_garble_while_talking", name: "Force garbled speech" },
    { id: "speech_block_antigarble", name: "Forbid the antigarble option" },
    { id: "block_using_unowned_items", name: "Prevent using items of others" },
    { id: "block_mainhall_maidrescue", name: "Forbid mainhall maid services" },
    { id: "block_club_slave_work", name: "Prevent working as club slave" },
    { id: "block_using_ggts", name: "Forbid using GGTS" },
    { id: "block_ui_icons_names", name: "Force-hide UI elements" },
    { id: "block_antiblind", name: "Forbid the antiblind command" },
    { id: "block_action", name: "Forbid the action command" },
    { id: "block_BCX_permissions", name: "Prevent using BCX permissions" },
    { id: "block_curses_self_by_others", name: "Prevent accessing curses by others" },
    { id: "block_rules_self_by_others", name: "Prevent accessing rules by others" },
    { id: "alt_eyes_fullblind", name: "Fully blind when eyes are closed" },
    { id: "alt_blindfolds_fullblind", name: "Fully blind when blindfolded" },
    { id: "alt_field_of_vision", name: "Field of vision for eyes" },
    { id: "alt_always_slow", name: "Always leave rooms slowly" },
    { id: "alt_set_leave_slowing", name: "Set slowed leave time" },
    { id: "alt_room_admin_transfer", name: "Room admin transfer" },
    { id: "alt_room_admin_limit", name: "Limit bound admin power" },
    { id: "alt_force_suitcase_game", name: "Always carry a suitcase" },
    { id: "alt_hide_friends", name: "Hide online friends if blind" },
    { id: "alt_allow_changing_appearance", name: "Allow changing the whole appearance" },
    { id: "other_forbid_afk", name: "Forbid going afk" },
    { id: "other_track_time", name: "Track rule effect time" },
    { id: "other_log_money", name: "Log money changes" },
    { id: "other_restrict_console_usage", name: "Restrict console usage" },
    { id: "other_track_BCX_activation", name: "Track BCX activation" },
    { id: "setting_random_npc_events", name: "Prevent random NPC events" },
];

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");
const isNumberArray = (v: unknown): v is number[] => Array.isArray(v) && v.every((n) => typeof n === "number");

/** The option label closest to a numeric BCX value (options are numeric strings). */
function nearestOption(options: readonly string[], value: unknown): string | null {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        return null;
    }
    return [...options].sort((a, b) => Math.abs(Number(a) - value) - Math.abs(Number(b) - value))[0] ?? null;
}

/** BCX "[word1,word2;substitute],[...]" syntax -> our "word:substitute" entries. */
function parseBcxReplaceSyntax(raw: string): string[] {
    const entries: string[] = [];
    for (const match of raw.matchAll(/\[([^\][;]+);([^\][]+)\]/g)) {
        const substitute = match[2]!.trim();
        for (const word of match[1]!.split(",")) {
            if (word.trim().length > 0 && substitute.length > 0) {
                entries.push(`${word.trim()}:${substitute}`);
            }
        }
    }
    return entries;
}

/** BCX AccessLevel (1=clubowner..7=public) -> BC+ Role; null for self/unknown. */
function bcxRoleToOurs(level: unknown): Role | null {
    return typeof level === "number" && level >= 1 && level <= 7 ? (level - 1) as Role : null;
}

type Translator = (data: Record<string, unknown>) => Record<string, unknown> | null;

/** Per-BCX-rule settings translation; null = untranslatable (review flag). */
const TRANSLATORS: Record<string, Translator> = {
    speech_ban_words: (d) => (isStringArray(d.bannedWords) ? { words: d.bannedWords } : null),
    speech_mandatory_words: (d) => (isStringArray(d.mandatoryWords) ? { words: d.mandatoryWords } : null),
    speech_restrained_speech: (d) =>
        (isStringArray(d.listOfAllowedSentences) ? { phrases: d.listOfAllowedSentences } : null),
    speech_replace_spoken_words: (d) => (typeof d.stringWithReplacingSyntax === "string"
        ? { replacements: parseBcxReplaceSyntax(d.stringWithReplacingSyntax) }
        : null),
    speech_doll_talk: (d) => {
        const result: Record<string, unknown> = {};
        const words = nearestOption(["3", "5", "7", "10"], d.maxNumberOfWords);
        const length = nearestOption(["4", "5", "6", "7", "8"], d.maxWordLength);
        if (words) {
            result.maxWords = words;
        }
        if (length) {
            result.maxWordLength = length;
        }
        // BCX uses 0 for "unlimited" - nothing to carry over then
        return Object.keys(result).length > 0 ? result : null;
    },
    alt_hearing_whitelist: (d) => (isNumberArray(d.whitelistedMembers)
        ? { members: d.whitelistedMembers, includeGagged: d.ignoreGaggedMembersToggle === true }
        : null),
    alt_seeing_whitelist: (d) => (isNumberArray(d.whitelistedMembers) ? { members: d.whitelistedMembers } : null),
    alt_forced_summoning: (d) => {
        const result: Record<string, unknown> = {};
        if (isNumberArray(d.allowedMembers)) {
            result.allowedMembers = d.allowedMembers;
        }
        if (typeof d.summoningText === "string" && d.summoningText.trim().length > 0) {
            result.summonText = d.summoningText.slice(0, 100);
        }
        const delay = nearestOption(["10", "15", "30", "60"], d.summonTime);
        if (delay) {
            result.delay = delay;
        }
        return Object.keys(result).length > 0 ? result : null;
    },
    other_constant_reminder: (d) => {
        const result: Record<string, unknown> = {};
        if (isStringArray(d.reminderText)) {
            result.sentences = d.reminderText;
        }
        const frequency = nearestOption(["2", "5", "10", "15", "30"], d.reminderFrequency);
        if (frequency) {
            result.frequency = frequency;
        }
        return Object.keys(result).length > 0 ? result : null;
    },
    greet_room_order: (d) => (typeof d.greetingSentence === "string" && d.greetingSentence.trim().length > 0
        ? { greeting: d.greetingSentence.slice(0, 200) }
        : null),
    block_blacklisting: (d) => {
        const role = bcxRoleToOurs(d.minimumRole);
        return role !== null ? { minRole: RoleNames[role] } : null;
    },
};

/** Generic translator for the forced-setting rules: BCX value -> our choice label. */
function settingRuleTranslator(bcpId: string, data: Record<string, unknown>): Record<string, unknown> | null {
    const choices = SETTING_RULE_CHOICES[bcpId];
    if (!choices) {
        return null;
    }
    // Toggle/list rules store the pinned value as `value`; the arousal meter
    // rule calls it `active`
    const bcxValue = data.value !== undefined ? data.value : data.active;
    const choice = choices.find((c) => c.value === bcxValue);
    if (!choice) {
        return null;
    }
    const result: Record<string, unknown> = { value: choice.label };
    if (typeof data.restore === "boolean") {
        result.restore = data.restore;
    }
    return result;
}

/** BCX condition requirements/timer -> BC+ conditions (AND semantics; BCX "or" is not representable). */
function convertConditions(condition: Record<string, unknown>): ConditionData | undefined {
    const result: ConditionData = {};
    if (typeof condition.timer === "number" && condition.timer > Date.now()) {
        result.timerEnd = condition.timer;
        result.timerAction = condition.timerRemove === true ? "remove" : "deactivate";
    }
    const requirements = condition.requirements as {
        room?: { type?: string; inverted?: true };
        roomName?: { name?: string; inverted?: true };
        role?: { role?: number; inverted?: true };
        player?: { memberNumber?: number; inverted?: true };
    } | undefined;
    if (requirements && typeof requirements === "object") {
        if (requirements.room?.type === "public" || requirements.room?.type === "private") {
            const type = requirements.room.type;
            result.roomType = requirements.room.inverted ? (type === "public" ? "private" : "public") : type;
        }
        if (typeof requirements.roomName?.name === "string" && requirements.roomName.name.length > 0) {
            result.roomNames = requirements.roomName.name;
            result.roomNamesMode = requirements.roomName.inverted ? "notin" : "in";
        }
        const role = bcxRoleToOurs(requirements.role?.role);
        if (role !== null) {
            result.role = role;
            result.roleMode = requirements.role?.inverted ? "absent" : "present";
        }
        if (typeof requirements.player?.memberNumber === "number") {
            result.members = String(requirements.player.memberNumber);
            result.membersMode = requirements.player.inverted ? "absent" : "present";
        }
    }
    return Object.keys(result).length > 0 ? result : undefined;
}

/** Reads the full BCX configuration and builds the migration plan. */
export function scanBCXMigration(rules: Rules, curses: Curses | undefined, api: BCX_ModAPI): MigrationPlan {
    const plan: MigrationPlan = { rules: [], curses: [], unmapped: [] };

    // BCX rule -> BC+ rule; when two BC+ rules share an equivalent (the pose
    // pair), the configurable one wins
    const reverse = new Map<string, string>();
    for (const definition of rules.Definitions) {
        if (!definition.bcxEquivalent) {
            continue;
        }
        if (!reverse.has(definition.bcxEquivalent) || (definition.settings?.length ?? 0) > 0) {
            reverse.set(definition.bcxEquivalent, definition.id);
        }
    }

    for (const [bcxId, bcpId] of reverse) {
        let state: BCX_RuleStateAPI | null;
        try {
            state = api.getRuleState(bcxId as BCX_Rule);
        } catch {
            continue;
        }
        const condition = state?.condition as Record<string, unknown> | null | undefined;
        if (!condition) {
            continue; // not added in BCX
        }
        const definition = rules.getDefinition(bcpId)!;
        const data = condition.data as { enforce?: false; log?: false; customData?: Record<string, unknown> } | undefined;
        const customData = data?.customData;
        let settings: Record<string, unknown> | null = null;
        if (customData && typeof customData === "object") {
            const translator: Translator | undefined = bcxId.startsWith("setting_")
                ? (d): Record<string, unknown> | null => settingRuleTranslator(bcpId, d)
                : TRANSLATORS[bcxId];
            try {
                settings = translator ? translator(customData) : null;
            } catch {
                settings = null;
            }
        }
        plan.rules.push({
            kind: "rule",
            bcpId,
            name: definition.name,
            bcxId,
            bcxActive: condition.active === true,
            enforce: data?.enforce !== false,
            log: data?.log !== false,
            conditions: convertConditions(condition),
            settings: settings ?? undefined,
            // Review: BCX carries configuration but the BC+ side would run on
            // defaults (untranslated), and the rule actually has settings
            review: settings === null && customData !== undefined && (definition.settings?.length ?? 0) > 0,
            alreadyActive: rules.peekRuleState(bcpId).active,
            locked: rules.isRuleWeldLocked(bcpId) || rules.isRuleContractBound(bcpId)
                || rules.isRulePunishmentForced(bcpId),
        });
    }
    plan.rules.sort((a, b) => a.name.localeCompare(b.name));

    if (curses) {
        for (const group of curses.curseableGroups()) {
            let info: BCX_CurseInfo | null;
            try {
                info = api.getCurseInfo(group.Name as AssetGroupName);
            } catch {
                continue;
            }
            if (!info) {
                continue;
            }
            const slot: CurseSlotData = {
                group: group.Name as AssetGroupName,
                active: info.active,
                allowEmpty: info.asset === null,
                items: info.asset === null ? [] : [{
                    asset: info.asset.Name,
                    name: info.asset.Description,
                    // BCX "curse properties" = enforce exact state; our strict
                    strict: info.curseProperty === true,
                    color: jsonClone(info.color) ?? undefined,
                    property: jsonClone(info.property) ?? undefined,
                }],
                addedBy: { member: Player.MemberNumber ?? -1, name: Player.Nickname || Player.Name },
            };
            plan.curses.push({
                kind: "curse",
                group: group.Name as AssetGroupName,
                label: info.asset === null
                    ? `${group.Description} - cursed empty`
                    : `${group.Description} - ${info.asset.Description}`,
                slot,
                alreadyCursed: curses.getSlot(group.Name) !== undefined,
            });
        }
        plan.curses.sort((a, b) => a.label.localeCompare(b.label));
    }

    for (const entry of BCX_UNMAPPED_RULES) {
        try {
            const condition = api.getRuleState(entry.id as BCX_Rule)?.condition;
            if (condition) {
                plan.unmapped.push({ bcxId: entry.id, name: entry.name });
            }
        } catch {
            // Unknown to this BCX version - nothing to report
        }
    }

    return plan;
}

export interface MigrationResult {
    rulesApplied: number;
    cursesApplied: number;
    reviewNames: string[];
    skippedNames: string[];
}

/** Applies the selected items to the player's own BC+ config (permission-gated by the caller). */
export function applyMigration(
    rules: Rules,
    curses: Curses | undefined,
    selectedRules: RuleMigrationItem[],
    selectedCurses: CurseMigrationItem[],
): MigrationResult {
    const result: MigrationResult = { rulesApplied: 0, cursesApplied: 0, reviewNames: [], skippedNames: [] };

    for (const item of selectedRules) {
        if (item.locked) {
            result.skippedNames.push(item.name);
            continue;
        }
        rules.setRuleEnforce(item.bcpId, item.enforce);
        rules.setRuleLog(item.bcpId, item.log);
        for (const [name, value] of Object.entries(item.settings ?? {})) {
            rules.setRuleSetting(item.bcpId, name, value);
        }
        if (item.conditions) {
            rules.setRuleUseGlobal(item.bcpId, false);
            rules.setRuleConditions(item.bcpId, item.conditions);
        }
        rules.setRuleActive(item.bcpId, item.bcxActive);
        result.rulesApplied++;
        if (item.review) {
            result.reviewNames.push(item.name);
        }
    }

    if (curses) {
        for (const item of selectedCurses) {
            curses.Slots[item.group] = jsonClone(item.slot);
            result.cursesApplied++;
        }
        if (selectedCurses.length > 0) {
            curses.Events.emit("curseChanged", { group: "*", active: true });
        }
    }

    return result;
}
