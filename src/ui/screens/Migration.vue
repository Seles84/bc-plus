<script setup lang="ts">
import { computed, ref } from "vue";
import { useBcpVersion } from "@/ui/composables";
import {
    CurseMigrationItem, MigrationPlan, RuleMigrationItem, applyMigration, scanBCXMigration,
} from "@/system/migration/BCXMigration";
import { describeConditions } from "@/system/conditions/Conditions";
import type Curses from "@/modules/Curses";
import type Rules from "@/modules/Rules";

const { version, touch, core } = useBcpVersion();

const rules = core.ModuleManager.getModule<Rules>("rules");
const curses = core.ModuleManager.getModule<Curses>("curses");

/** Scanned once on open; read-only towards BCX. */
const plan = ((): MigrationPlan | null => {
    const api = core.SDK.bcxAPI();
    if (!rules || !api) {
        return null;
    }
    try {
        return scanBCXMigration(rules, curses, api);
    } catch {
        return null;
    }
})();

function key(item: RuleMigrationItem | CurseMigrationItem): string {
    return item.kind === "rule" ? `rule:${item.bcpId}` : `curse:${item.group}`;
}

const selected = ref(new Set<string>());
// Preselect everything that is sensible to migrate
for (const item of plan?.rules ?? []) {
    if (!item.locked && !item.alreadyActive && item.bcxActive) {
        selected.value.add(key(item));
    }
}
for (const item of plan?.curses ?? []) {
    if (!item.alreadyCursed) {
        selected.value.add(key(item));
    }
}

const canEdit = computed(() => {
    version.value;
    return (rules?.canEdit() ?? false) && (curses?.canEdit() ?? true);
});

function toggle(item: RuleMigrationItem | CurseMigrationItem): void {
    const k = key(item);
    if (selected.value.has(k)) {
        selected.value.delete(k);
    } else {
        selected.value.add(k);
    }
}

function selectAll(): void {
    for (const item of [...(plan?.rules ?? []), ...(plan?.curses ?? [])]) {
        if (!("locked" in item) || !item.locked) {
            selected.value.add(key(item));
        }
    }
}

function selectNone(): void {
    selected.value.clear();
}

function detail(item: RuleMigrationItem | CurseMigrationItem): string {
    if (item.kind === "curse") {
        const parts = [item.slot.active ? "active" : "switched off"];
        if (item.slot.items[0]?.strict) {
            parts.push("exact state kept");
        }
        if (item.alreadyCursed) {
            parts.push("replaces the existing BC+ curse on this slot");
        }
        return parts.join(" · ");
    }
    if (item.locked) {
        return "locked in BC+ (weld/contract/punishment) - cannot migrate";
    }
    const parts = [item.bcxActive ? "on" : "added but switched off"];
    parts.push(item.enforce ? "enforced" : "not enforced");
    if (item.conditions) {
        parts.push(describeConditions(item.conditions));
    }
    if (item.settings) {
        parts.push("settings translated");
    } else if (item.review) {
        parts.push("review settings after migrating");
    }
    if (item.alreadyActive) {
        parts.push("already active in BC+ (would overwrite)");
    }
    return parts.join(" · ");
}

const migrateArmedUntil = ref(0);
const resultLines = ref<string[]>([]);
function migrate(): void {
    if (!plan || !rules || selected.value.size === 0 || !canEdit.value) {
        return;
    }
    if (Date.now() >= migrateArmedUntil.value) {
        migrateArmedUntil.value = Date.now() + 6_000;
        return;
    }
    migrateArmedUntil.value = 0;
    const selectedRules = plan.rules.filter((item) => selected.value.has(key(item)));
    const selectedCurses = plan.curses.filter((item) => selected.value.has(key(item)));
    const result = applyMigration(rules, curses, selectedRules, selectedCurses);
    const lines = [`Migrated ${result.rulesApplied} rule${result.rulesApplied === 1 ? "" : "s"} `
        + `and ${result.cursesApplied} curse${result.cursesApplied === 1 ? "" : "s"}.`];
    if (result.reviewNames.length > 0) {
        lines.push(`Review the settings of: ${result.reviewNames.join(", ")}.`);
    }
    if (result.skippedNames.length > 0) {
        lines.push(`Skipped (locked): ${result.skippedNames.join(", ")}.`);
    }
    lines.push("While BCX still enforces a rule, the BC+ twin defers to it - switch the BCX "
        + "rule off whenever ready and BC+ takes over.");
    resultLines.value = lines;
    touch();
}
</script>

<template>
    <div class="mx-auto flex max-w-3xl flex-col gap-3">
        <p class="text-sm text-fg-dim">
            Everything configured in your BCX, ready to copy into BC+. Ticked items are applied
            when you press Migrate; nothing in BCX is changed, and while a BCX rule is still in
            effect the migrated BC+ twin politely defers to it.
        </p>

        <p v-if="!plan" class="px-2 text-fg-dim">
            BCX was not detected - the migration tool needs BCX running alongside BC+.
        </p>
        <p v-else-if="plan.rules.length === 0 && plan.curses.length === 0" class="px-2 text-fg-dim">
            Nothing to migrate: no rules or curses are configured in BCX.
        </p>
        <template v-else>
            <div class="flex flex-wrap items-center gap-2">
                <span class="text-sm text-fg-dim">{{ selected.size }} selected</span>
                <span class="flex-1"></span>
                <button
                    class="rounded-lg bg-surface px-3 py-1.5 hover:bg-surface-hover"
                    style="border: 1px solid var(--bcp-border);"
                    @click="selectAll()"
                >Select all</button>
                <button
                    class="rounded-lg bg-surface px-3 py-1.5 hover:bg-surface-hover"
                    style="border: 1px solid var(--bcp-border);"
                    @click="selectNone()"
                >Select none</button>
                <button
                    class="rounded-lg px-4 py-1.5 font-semibold disabled:opacity-50"
                    :style="Date.now() < migrateArmedUntil
                        ? 'background: #e05252; color: #fff;'
                        : 'background: var(--bcp-accent); color: var(--bcp-on-accent);'"
                    :disabled="!canEdit || selected.size === 0"
                    :title="canEdit
                        ? 'Apply every ticked item to your BC+ configuration (BCX is not changed)'
                        : 'Requires permission to edit your own rules and curses'"
                    @click="migrate()"
                >{{ Date.now() < migrateArmedUntil ? "Click again to migrate" : "Migrate" }}</button>
            </div>

            <div v-if="resultLines.length > 0" class="flex flex-col gap-1 rounded-lg bg-surface p-3 text-sm" style="border: 1px solid var(--bcp-border);">
                <p v-for="line in resultLines" :key="line">{{ line }}</p>
            </div>

            <div class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
                <template v-if="plan.rules.length > 0">
                    <h3 class="px-3 pt-1 font-semibold text-accent">Rules ({{ plan.rules.length }})</h3>
                    <label
                        v-for="item in plan.rules"
                        :key="item.bcpId"
                        class="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-1.5 hover:bg-surface"
                        :class="{ 'opacity-50': item.locked || !canEdit }"
                    >
                        <input
                            type="checkbox" class="mt-0.5 h-5 w-5" style="accent-color: var(--bcp-accent);"
                            :checked="selected.has(key(item))" :disabled="item.locked || !canEdit"
                            @change="toggle(item)"
                        >
                        <span class="min-w-0">
                            <span class="block">{{ item.name }}</span>
                            <span class="block text-sm" :style="{ color: item.locked ? '#e05252' : 'var(--bcp-text-dim)' }">{{ detail(item) }}</span>
                        </span>
                    </label>
                </template>
                <template v-if="plan.curses.length > 0">
                    <h3 class="px-3 pt-2 font-semibold text-accent">Curses ({{ plan.curses.length }})</h3>
                    <label
                        v-for="item in plan.curses"
                        :key="item.group"
                        class="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-1.5 hover:bg-surface"
                        :class="{ 'opacity-50': !canEdit }"
                    >
                        <input
                            type="checkbox" class="mt-0.5 h-5 w-5" style="accent-color: var(--bcp-accent);"
                            :checked="selected.has(key(item))" :disabled="!canEdit"
                            @change="toggle(item)"
                        >
                        <span class="min-w-0">
                            <span class="block">{{ item.label }}</span>
                            <span class="block text-sm text-fg-dim">{{ detail(item) }}</span>
                        </span>
                    </label>
                </template>
                <template v-if="plan.unmapped.length > 0">
                    <h3 class="px-3 pt-2 font-semibold text-accent">No BC+ counterpart - stays in BCX ({{ plan.unmapped.length }})</h3>
                    <p v-for="unmapped in plan.unmapped" :key="unmapped.bcxId" class="px-11 text-sm text-fg-dim">
                        {{ unmapped.name }}
                    </p>
                </template>
            </div>
        </template>
    </div>
</template>
