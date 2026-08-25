<script setup lang="ts">
import { computed, ref } from "vue";
import { useBcpVersion } from "@/ui/composables";
import { COUNTER_LABELS, STATE_LABELS, formatStatDuration } from "@/system/statistics/StatTypes";
import type Rules from "@/modules/Rules";
import type Statistics from "@/modules/Statistics";

const { version, touch, core } = useBcpVersion();

const statistics = core.ModuleManager.getModule<Statistics>("statistics")!;

const canView = computed(() => {
    version.value;
    return statistics.canView();
});
const canReset = computed(() => {
    version.value;
    return statistics.canReset();
});
const stats = computed(() => {
    version.value;
    return canView.value ? statistics.snapshot() : null;
});

const tab = ref<"overview" | "items" | "rules">("overview");

function withShare(ms: number): string {
    const play = stats.value?.play ?? 0;
    const share = play > 0 ? Math.min(100, Math.round((ms / play) * 100)) : 0;
    return `${formatStatDuration(ms)} (${share}%)`;
}

const itemRows = computed(() =>
    Object.entries(stats.value?.items ?? {}).sort((a, b) => b[1] - a[1]));

const ruleRows = computed(() => {
    const rules = core.ModuleManager.getModule<Rules>("rules");
    return Object.entries(stats.value?.rules ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([id, count]) => ({ label: rules?.getDefinition(id)?.name ?? id, count }));
});

const resetArmedUntil = ref(0);
function resetStats(): void {
    if (Date.now() < resetArmedUntil.value) {
        statistics.resetStats();
        resetArmedUntil.value = 0;
        touch();
    } else {
        resetArmedUntil.value = Date.now() + 5_000;
    }
}
</script>

<template>
    <div class="flex h-full flex-col gap-3">
        <p v-if="!canView" class="px-2 text-fg-dim">You are not permitted to view your own statistics.</p>
        <template v-else-if="stats">
            <div class="flex flex-wrap items-center gap-3 px-2 text-sm text-fg-dim">
                <span>Recording since {{ stats.since > 0 ? new Date(stats.since).toLocaleDateString() : "-" }}</span>
                <span>&middot;</span>
                <span>Total play time: {{ formatStatDuration(stats.play) }}</span>
                <span class="flex-1"></span>
                <button
                    v-for="entry in ([['overview', 'Overview'], ['items', 'Items'], ['rules', 'Rule violations']] as const)"
                    :key="entry[0]"
                    class="rounded-full px-3 py-1"
                    :style="tab === entry[0]
                        ? 'background: var(--bcp-accent); color: var(--bcp-on-accent);'
                        : 'background: var(--bcp-surface); border: 1px solid var(--bcp-border);'"
                    @click="tab = entry[0]"
                >{{ entry[1] }}</button>
            </div>

            <div v-if="tab === 'overview'" class="grid min-h-0 flex-1 grid-cols-1 content-start gap-x-8 gap-y-0.5 overflow-y-auto md:grid-cols-2">
                <div>
                    <h3 class="px-3 pb-1 font-semibold text-accent">Time spent</h3>
                    <div
                        v-for="state in STATE_LABELS"
                        :key="state.id"
                        class="flex items-baseline gap-2 rounded px-3 py-1 hover:bg-surface"
                    >
                        <span class="min-w-0 flex-1 truncate">{{ state.label }}</span>
                        <span class="text-sm text-fg-dim">{{ withShare(stats.states[state.id] ?? 0) }}</span>
                    </div>
                </div>
                <div>
                    <h3 class="px-3 pb-1 font-semibold text-accent">Events</h3>
                    <div
                        v-for="counter in COUNTER_LABELS"
                        :key="counter.id"
                        class="flex items-baseline gap-2 rounded px-3 py-1 hover:bg-surface"
                    >
                        <span class="min-w-0 flex-1 truncate">{{ counter.label }}</span>
                        <span class="text-sm text-fg-dim">{{ stats.counters[counter.id] ?? 0 }}</span>
                    </div>
                </div>
            </div>

            <div v-else-if="tab === 'items'" class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
                <p v-if="itemRows.length === 0" class="px-3 text-fg-dim">No item time recorded yet.</p>
                <div
                    v-for="[name, ms] in itemRows"
                    :key="name"
                    class="flex items-baseline gap-2 rounded px-3 py-1 hover:bg-surface"
                >
                    <span class="min-w-0 flex-1 truncate">{{ name }}</span>
                    <span class="text-sm text-fg-dim">{{ withShare(ms) }}</span>
                </div>
            </div>

            <div v-else class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
                <p v-if="ruleRows.length === 0" class="px-3 text-fg-dim">No rule violations recorded yet.</p>
                <div
                    v-for="row in ruleRows"
                    :key="row.label"
                    class="flex items-baseline gap-2 rounded px-3 py-1 hover:bg-surface"
                >
                    <span class="min-w-0 flex-1 truncate">{{ row.label }}</span>
                    <span class="text-sm text-fg-dim">{{ row.count }}</span>
                </div>
            </div>

            <div v-if="canReset" class="flex border-t pt-3" style="border-color: var(--bcp-border);">
                <button
                    class="rounded-lg px-4 py-2"
                    :style="Date.now() < resetArmedUntil
                        ? 'background: rgba(224,82,82,0.25); border: 1px solid #e05252; color: #e05252;'
                        : 'background: var(--bcp-surface); border: 1px solid var(--bcp-border);'"
                    title="Wipes all counters and starts over"
                    @click="resetStats()"
                >{{ Date.now() < resetArmedUntil ? "Confirm reset" : "Reset stats" }}</button>
            </div>
        </template>
    </div>
</template>
