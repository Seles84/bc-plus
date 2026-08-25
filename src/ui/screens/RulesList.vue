<script setup lang="ts">
import { computed, inject } from "vue";
import { NAV_KEY } from "@/ui/nav";
import { useBcpVersion } from "@/ui/composables";
import RuleCatalog from "@/ui/screens/RuleCatalog.vue";
import RuleConfig from "@/ui/screens/RuleConfig.vue";
import Conditions from "@/ui/screens/Conditions.vue";
import { LocalRuleAccess, RemoteRuleAccess } from "@/system/rules/RuleAccess";
import { bcpCharacter } from "@/ui/composables";
import type { RuleDefinition } from "@/system/rules/RuleTypes";
import type Authority from "@/modules/Authority";
import type Rules from "@/modules/Rules";

const props = defineProps<{ member?: number }>();
const nav = inject(NAV_KEY)!;
const { version, touch, core } = useBcpVersion();

const rules = core.ModuleManager.getModule<Rules>("rules")!;
const local = props.member === undefined;
const character = bcpCharacter(props.member);
/** Remote target left the room before this screen opened. */
const dead = !local && character === null;
const access = character
    ? new RemoteRuleAccess(rules, core.ModuleManager.getModule<Authority>("authority"), character)
    : new LocalRuleAccess(rules);

const CATEGORY_ORDER = ["Speech", "Social", "Body", "Items", "Protection", "Sensory", "Rooms", "Settings", "Pet", "Other"] as const;

const canEdit = computed(() => {
    version.value;
    return access.canEdit();
});
const sortMode = computed(() => {
    version.value;
    return access.sortMode();
});

interface Row {
    header?: string;
    definition?: RuleDefinition;
}

/** Active rules (plus BCX-covered ones) in the preferred presentation. */
const listRows = computed<Row[]>(() => {
    version.value;
    const active = access.definitions().filter((d) =>
        access.state(d.id).active || access.bcxStatus(d.id) !== "none");
    if (sortMode.value === "custom") {
        const position = new Map(access.order().map((id, i) => [id, i]));
        return active
            .sort((a, b) => (position.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.id) ?? Number.MAX_SAFE_INTEGER))
            .map((definition) => ({ definition }));
    }
    const rows: Row[] = [];
    for (const category of CATEGORY_ORDER) {
        const group = active.filter((d) => d.category === category);
        if (group.length > 0) {
            rows.push({ header: category });
            rows.push(...group.map((definition) => ({ definition })));
        }
    }
    return rows;
});

/** Ids of the truly-active rules in display order (for reorder + bulk). */
const displayedIds = computed(() =>
    listRows.value.flatMap((row) => (row.definition && access.state(row.definition.id).active ? [row.definition.id] : [])));

interface Chip {
    text: string;
    color: string;
}

function chipFor(definition: RuleDefinition): Chip {
    const state = access.state(definition.id);
    const welded = access.weldLocked(definition.id);
    // Punishment/contract binding and live in-effect state are local-only
    // knowledge (not synced); remote views show the plain enforce state
    const punished = !welded && local && rules.isRulePunishmentForced(definition.id);
    const contracted = !welded && !punished && local && rules.isRuleContractBound(definition.id);
    const bcxStatus = !welded && !punished && !contracted ? access.bcxStatus(definition.id) : "none";
    const deferred = bcxStatus === "inEffect";
    const bcxIdle = bcxStatus === "active" && !state.active;
    const waiting = !welded && !punished && !contracted && !deferred && !bcxIdle
        && local && state.active && state.enforce && !rules.ruleInEffect(definition.id);
    if (welded) {
        return { text: "Welded", color: "#e05252" };
    }
    if (punished) {
        return { text: "Punished", color: "#e05252" };
    }
    if (contracted) {
        return { text: "Contract", color: "#a97fe0" };
    }
    if (deferred) {
        return { text: "BCX", color: "#daa520" };
    }
    if (bcxIdle) {
        return { text: "BCX wait", color: "#b0a068" };
    }
    if (waiting) {
        return { text: "Waiting", color: "#b0a068" };
    }
    return state.enforce ? { text: "Enforced", color: "#4caf6d" } : { text: "Paused", color: "var(--bcp-text-dim)" };
}

function hasConditions(definition: RuleDefinition): boolean {
    const state = access.state(definition.id);
    const conditions = state.useGlobal === true ? access.globalConditions() : state.conditions;
    return conditions !== undefined && Object.keys(conditions).length > 0;
}

function openRule(definition: RuleDefinition): void {
    nav.push({ component: RuleConfig, title: definition.name, props: { ruleId: definition.id, member: props.member } });
}

function openCatalog(): void {
    nav.push({ component: RuleCatalog, title: "Add rule", props: { member: props.member } });
}

function setAll(enforce: boolean): void {
    displayedIds.value.forEach((id) => access.setEnforce(id, enforce));
    touch();
}

// --- Remote batching: edits queue until saved ---
const pendingCount = computed(() => {
    version.value;
    return access.pendingCount();
});
function saveEdits(): void {
    access.save();
    touch();
}
function discardEdits(): void {
    access.discard();
    touch();
}

function toggleSort(): void {
    rules.setSortMode(sortMode.value === "custom" ? "category" : "custom");
    touch();
}

function move(definition: RuleDefinition, delta: -1 | 1): void {
    rules.moveRuleInOrder(definition.id, delta, displayedIds.value);
    touch();
}

function openGlobalConditions(): void {
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
}
</script>

<template>
    <p v-if="dead" class="text-fg-dim">They are no longer in this room.</p>
    <div v-else class="flex h-full flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2">
            <button
                class="rounded-lg px-4 py-2 font-semibold disabled:opacity-50"
                style="background: var(--bcp-accent); color: var(--bcp-on-accent);"
                :disabled="!canEdit"
                @click="openCatalog()"
            >Add rule</button>
            <button
                class="rounded-lg bg-surface px-3 py-2 hover:bg-surface-hover disabled:opacity-50"
                style="border: 1px solid var(--bcp-border);"
                :disabled="!canEdit || displayedIds.length === 0"
                title="Enforce every active rule"
                @click="setAll(true)"
            >Enable all</button>
            <button
                class="rounded-lg bg-surface px-3 py-2 hover:bg-surface-hover disabled:opacity-50"
                style="border: 1px solid var(--bcp-border);"
                :disabled="!canEdit || displayedIds.length === 0"
                title="Pause enforcement of every active rule (they stay configured)"
                @click="setAll(false)"
            >Disable all</button>
            <span class="flex-1"></span>
            <button
                v-if="local"
                class="rounded-lg bg-surface px-3 py-2 hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                @click="toggleSort()"
            >Sort: {{ sortMode === "custom" ? "Custom" : "Category" }}</button>
        </div>

        <p v-if="listRows.length === 0" class="px-2 text-fg-dim">
            No rules are active. Use "Add rule" to pick from the catalog.
        </p>

        <div class="@container min-h-0 flex-1 overflow-y-auto">
            <div class="grid grid-cols-1 content-start gap-x-8 gap-y-0.5 @3xl:grid-cols-2 @6xl:grid-cols-3">
            <template v-for="(row, index) in listRows" :key="row.header ?? row.definition!.id">
                <div v-if="row.header" class="col-span-full px-2 pt-2 text-sm font-semibold text-fg-dim" :class="{ 'pt-0': index === 0 }">
                    {{ row.header }}
                </div>
                <div
                    v-else
                    class="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 hover:bg-surface"
                    :title="row.definition!.description"
                    @click="openRule(row.definition!)"
                >
                    <span class="min-w-0 flex-1 truncate">{{ row.definition!.name }}</span>
                    <span v-if="hasConditions(row.definition!)" class="text-fg-dim" title="Conditions are configured">&#9672;</span>
                    <span
                        class="w-20 shrink-0 text-right text-sm font-semibold"
                        :style="{ color: chipFor(row.definition!).color }"
                    >{{ chipFor(row.definition!).text }}</span>
                    <span
                        v-if="local && sortMode === 'custom' && canEdit && access.state(row.definition!.id).active"
                        class="flex shrink-0 gap-1"
                        @click.stop
                    >
                        <button
                            class="rounded bg-surface px-1.5 text-sm disabled:opacity-30"
                            style="border: 1px solid var(--bcp-border);"
                            :disabled="displayedIds.indexOf(row.definition!.id) <= 0"
                            title="Move up"
                            @click="move(row.definition!, -1)"
                        >&#9650;</button>
                        <button
                            class="rounded bg-surface px-1.5 text-sm disabled:opacity-30"
                            style="border: 1px solid var(--bcp-border);"
                            :disabled="displayedIds.indexOf(row.definition!.id) >= displayedIds.length - 1"
                            title="Move down"
                            @click="move(row.definition!, 1)"
                        >&#9660;</button>
                    </span>
                </div>
            </template>
            </div>
        </div>

        <div class="flex flex-wrap items-center gap-3 border-t pt-2" style="border-color: var(--bcp-border);">
            <button
                class="rounded-lg bg-surface px-3 py-2 hover:bg-surface-hover disabled:opacity-50"
                style="border: 1px solid var(--bcp-border);"
                :disabled="!canEdit"
                title="The shared conditions set that rules with 'Follow global conditions' obey"
                @click="openGlobalConditions()"
            >Global conditions...</button>
            <span v-if="!canEdit" class="text-sm text-fg-dim">You do not have permission to change these rules; viewing only.</span>
            <template v-if="pendingCount > 0">
                <span class="flex-1"></span>
                <span class="text-sm font-semibold" style="color: #d09030;">{{ pendingCount }} unsaved</span>
                <button
                    class="rounded-lg px-4 py-2 font-semibold"
                    style="background: var(--bcp-accent); color: var(--bcp-on-accent);"
                    title="Send every pending change in one batch"
                    @click="saveEdits()"
                >Save</button>
                <button
                    class="rounded-lg bg-surface px-3 py-2 hover:bg-surface-hover"
                    style="border: 1px solid var(--bcp-border);"
                    title="Drop the pending changes without sending them"
                    @click="discardEdits()"
                >Discard</button>
            </template>
        </div>
    </div>
</template>
