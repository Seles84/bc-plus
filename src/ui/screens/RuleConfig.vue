<script setup lang="ts">
import { computed, inject } from "vue";
import { NAV_KEY } from "@/ui/nav";
import { useBcpVersion } from "@/ui/composables";
import SettingRow from "@/ui/components/SettingRow.vue";
import Conditions from "@/ui/screens/Conditions.vue";
import { PICKER_KEY } from "@/ui/picker";
import RulePunish from "@/ui/screens/RulePunish.vue";
import { LocalRuleAccess, RemoteRuleAccess } from "@/system/rules/RuleAccess";
import { bcpCharacter } from "@/ui/composables";
import type { RuleAccess } from "@/system/rules/RuleAccess";
import type Authority from "@/modules/Authority";
import type { PunishmentDefinition } from "@/system/punishments/PunishmentTypes";
import { describeConditions } from "@/system/conditions/Conditions";
import { defaultPunishConfig } from "@/system/punishments/PunishmentTypes";
import { membersValue } from "@/system/gui/Settings";
import type { AnySetting } from "@/system/gui/Settings";
import type Contracts from "@/modules/Contracts";
import type Punishments from "@/modules/Punishments";
import type Rules from "@/modules/Rules";

const props = defineProps<{
    ruleId: string;
    /** Viewing/editing another character's rule. */
    member?: number;
    /** Injected access (e.g. a contract draft); wins over member. */
    access?: RuleAccess;
    /** Contract-draft mode: live-state banners and punishments are hidden. */
    draft?: boolean;
}>();
const nav = inject(NAV_KEY)!;
const picker = inject(PICKER_KEY)!;
const { version, touch, core } = useBcpVersion();

const rules = core.ModuleManager.getModule<Rules>("rules")!;
const character = props.access ? null : bcpCharacter(props.member);
// A remote target that no longer resolves must NEVER fall back to local
// access - rule ids are identical on every client, so the edits would
// silently apply to the viewer's own rules.
const dead = computed(() => {
    version.value;
    return props.access === undefined && props.member !== undefined && bcpCharacter(props.member) === null;
});
const access = props.access
    ?? (character
        ? new RemoteRuleAccess(rules, core.ModuleManager.getModule<Authority>("authority"), character)
        : new LocalRuleAccess(rules));
const isDraft = props.draft === true;
/** Local live state (punishment/contract binding) is meaningless remotely. */
const local = props.access === undefined && props.member === undefined;
const definition = rules.getDefinition(props.ruleId);

const state = computed(() => {
    version.value;
    return access.state(props.ruleId);
});
const canEdit = computed(() => {
    version.value;
    return access.canEdit();
});
const weldLocked = computed(() => {
    version.value;
    return !isDraft && access.weldLocked(props.ruleId);
});
const contractBound = computed(() => {
    version.value;
    return local && rules.isRuleContractBound(props.ruleId);
});
const punishmentForced = computed(() => {
    version.value;
    return local && rules.isRulePunishmentForced(props.ruleId);
});
const bcxStatus = computed(() => {
    version.value;
    return isDraft ? "none" : access.bcxStatus(props.ruleId);
});
const locked = computed(() => weldLocked.value || contractBound.value);

const contractTitle = computed(() =>
    core.ModuleManager.getModule<Contracts>("contracts")?.boundBy(props.ruleId)?.title ?? "?");

interface Toggle {
    label: string;
    value: boolean;
    lockable: boolean;
    set: (v: boolean) => void;
}

const toggles = computed<Toggle[]>(() => [
    { label: isDraft ? "Included in the contract" : "Rule is active", value: state.value.active, lockable: true, set: (v) => access.setActive(props.ruleId, v) },
    { label: "Enforce (block the action)", value: state.value.enforce, lockable: true, set: (v) => access.setEnforce(props.ruleId, v) },
    { label: "Log violations", value: state.value.log, lockable: false, set: (v) => access.setLog(props.ruleId, v) },
    { label: "Announce breaches in chat", value: state.value.announce, lockable: false, set: (v) => access.setAnnounce(props.ruleId, v) },
]);

function flip(toggle: Toggle): void {
    if (canEdit.value && !(toggle.lockable && locked.value)) {
        toggle.set(!toggle.value);
        touch();
    }
}

// --- Remote batching ---
const pendingCount = computed(() => {
    version.value;
    return access.pendingCount();
});
function saveEdits(): void {
    access.save();
    touch();
}

// --- Conditions ---
const usesGlobal = computed(() => state.value.useGlobal === true);
const conditionsSummary = computed(() => {
    if (usesGlobal.value) {
        return isDraft ? "Follows the signer's global conditions" : `Global: ${describeConditions(access.globalConditions())}`;
    }
    return describeConditions(state.value.conditions);
});

function toggleUseGlobal(): void {
    if (canEdit.value && !locked.value) {
        access.setUseGlobal(props.ruleId, !usesGlobal.value);
        touch();
    }
}

function openConditions(): void {
    if (usesGlobal.value) {
        nav.push({
            component: Conditions,
            title: "Global conditions",
            props: {
                removeLabel: "Deactivate",
                hideTimer: true,
                get: () => access.globalConditions(),
                set: (c: unknown) => access.setGlobalConditions(c as never),
                canEdit: () => access.canEdit(),
            },
        });
    } else {
        nav.push({
            component: Conditions,
            title: `Conditions - ${definition?.name ?? ""}`,
            props: {
                removeLabel: "Deactivate & clear",
                get: () => access.state(props.ruleId).conditions ?? {},
                set: (c: unknown) => access.setConditions(props.ruleId, c as never),
                canEdit: () => access.canEdit(),
            },
        });
    }
}

// --- Punishments attachment ---
const punishSummary = computed(() => {
    const punish = state.value.punish;
    if (!punish || punish.punishments.length === 0) {
        return "No punishments attached";
    }
    return `${punish.punishments.length} punishment${punish.punishments.length === 1 ? "" : "s"}`
        + (punish.threshold > 1 ? ` after ${punish.threshold} violations in ${punish.windowMin} min` : ", every violation");
});

function openPunish(): void {
    nav.push({
        component: RulePunish,
        title: `Punishments - ${definition?.name ?? ""}`,
        props: {
            get: () => access.state(props.ruleId).punish ?? defaultPunishConfig(),
            set: (c: unknown) => access.setPunish(props.ruleId, c as never),
            canEdit: () => access.canEdit(),
            // Remote: the target's punishment definitions from their mirror
            definitions: () => (character
                ? ((character.BCPData?.["punishments"]?.["punishments"] ?? {}) as Record<string, PunishmentDefinition>)
                : core.ModuleManager.getModule<Punishments>("punishments")?.Definitions ?? {}),
        },
    });
}

// --- Custom settings ---
function settingValue(setting: AnySetting): unknown {
    return state.value.settings[setting.name] ?? setting.default;
}

function settingActive(setting: AnySetting): boolean {
    version.value;
    return canEdit.value && (setting.active?.() ?? true);
}

function setSetting(setting: AnySetting, value: unknown): void {
    access.setSetting(props.ruleId, setting.name, value);
    touch();
}

function pickMembers(setting: AnySetting): void {
    void picker.pickMembers({
        title: setting.label,
        initial: membersValue(settingValue(setting)),
    }).then((members) => {
        if (members !== null) {
            setSetting(setting, members);
        }
    });
}
</script>

<template>
    <p v-if="dead" class="text-fg-dim">They are no longer in this room.</p>
    <div v-else-if="definition" class="mx-auto flex max-w-3xl flex-col gap-4">
        <p class="text-sm text-fg-dim">{{ definition.description }}</p>

        <div v-if="pendingCount > 0" class="flex items-center gap-3 rounded-lg bg-surface px-3 py-2" style="border: 1px solid var(--bcp-border);">
            <span class="min-w-0 flex-1 text-sm font-semibold" style="color: #d09030;">{{ pendingCount }} unsaved change{{ pendingCount === 1 ? "" : "s" }}</span>
            <button
                class="rounded-lg px-4 py-1.5 font-semibold"
                style="background: var(--bcp-accent); color: var(--bcp-on-accent);"
                title="Send every pending change in one batch - discard from the rules list"
                @click="saveEdits()"
            >Save</button>
        </div>

        <!-- Status banners -->
        <p v-if="weldLocked" class="rounded-lg px-3 py-2 text-sm" style="background: rgba(224,82,82,0.12); color: #e05252;">
            Locked by a welded collar - forced on and unconditional until the weld ends.
        </p>
        <p v-else-if="contractBound" class="rounded-lg px-3 py-2 text-sm" style="background: rgba(169,127,224,0.12); color: #a97fe0;">
            Bound by the signed contract "{{ contractTitle }}" - sealed until the contract ends.
        </p>
        <p v-else-if="bcxStatus === 'inEffect'" class="rounded-lg px-3 py-2 text-sm" style="background: rgba(218,165,32,0.12); color: #daa520;">
            {{ state.active
                ? "Paused - BCX's matching rule is in effect, so BC+ defers to it."
                : "BCX's matching rule is in effect - activating this in BC+ is redundant while it is." }}
        </p>
        <p v-else-if="bcxStatus === 'active'" class="rounded-lg px-3 py-2 text-sm" style="background: rgba(176,160,104,0.12); color: #b0a068;">
            BCX has this rule active, but its conditions do not hold right now - BC+ is not
            deferring{{ state.active ? "" : "; activating it here lets BC+ cover the gap" }}.
        </p>
        <p v-if="punishmentForced" class="rounded-lg px-3 py-2 text-sm" style="background: rgba(224,82,82,0.12); color: #e05252;">
            Enforced as a punishment right now - unconditional until the punishment ends.
        </p>

        <!-- Toggles -->
        <section class="flex flex-col gap-1">
            <label
                v-for="toggle in toggles"
                :key="toggle.label"
                class="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface"
                :class="{ 'opacity-50': !canEdit || (toggle.lockable && locked) }"
            >
                <input
                    type="checkbox"
                    class="h-5 w-5"
                    style="accent-color: var(--bcp-accent);"
                    :checked="toggle.value"
                    :disabled="!canEdit || (toggle.lockable && locked)"
                    @change="flip(toggle)"
                >
                <span>{{ toggle.label }}</span>
            </label>
            <p v-if="state.active && state.addedBy" class="px-3 text-sm text-fg-dim">
                Set by {{ state.addedBy.name }} (#{{ state.addedBy.member }})
            </p>
        </section>

        <!-- Conditions -->
        <section class="flex flex-col gap-2 rounded-lg bg-surface p-3" style="border: 1px solid var(--bcp-border);">
            <label class="flex cursor-pointer items-center gap-3" :class="{ 'opacity-50': !canEdit || locked }">
                <input
                    type="checkbox"
                    class="h-5 w-5"
                    style="accent-color: var(--bcp-accent);"
                    :checked="usesGlobal"
                    :disabled="!canEdit || locked"
                    @change="toggleUseGlobal()"
                >
                <span>Follow global conditions</span>
            </label>
            <div class="flex items-center gap-3">
                <button
                    class="rounded-lg bg-bg px-3 py-1.5 hover:bg-surface-hover disabled:opacity-50"
                    style="border: 1px solid var(--bcp-border);"
                    :disabled="locked || (isDraft && usesGlobal)"
                    :title="usesGlobal
                        ? 'When rules following the global set are in effect - editing affects all of them'
                        : 'When this rule is in effect'"
                    @click="openConditions()"
                >{{ usesGlobal ? "Global conditions..." : "Conditions..." }}</button>
                <span class="min-w-0 flex-1 truncate text-sm text-fg-dim">{{ conditionsSummary }}</span>
            </div>
        </section>

        <!-- Punishments -->
        <section v-if="!isDraft" class="flex items-center gap-3 rounded-lg bg-surface p-3" style="border: 1px solid var(--bcp-border);">
            <button
                class="rounded-lg bg-bg px-3 py-1.5 hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                title="What happens when this rule is broken"
                @click="openPunish()"
            >Punishments...</button>
            <span class="min-w-0 flex-1 truncate text-sm text-fg-dim">{{ punishSummary }}</span>
        </section>

        <!-- Custom settings -->
        <section v-if="definition.settings && definition.settings.length > 0" class="flex flex-col gap-1">
            <h3 class="px-3 font-semibold text-accent">Settings</h3>
            <SettingRow
                v-for="setting in definition.settings"
                :key="setting.name"
                :setting="setting"
                :value="settingValue(setting)"
                :disabled="!settingActive(setting)"
                @update="setSetting(setting, $event)"
                @pick-members="pickMembers(setting)"
            />
        </section>
    </div>
    <p v-else class="text-fg-dim">Unknown rule.</p>
</template>
