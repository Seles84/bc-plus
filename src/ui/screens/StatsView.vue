<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { bcpCharacter, useBcpVersion, useNow } from "@/ui/composables";
import { COUNTER_LABELS, STATE_LABELS, formatStatDuration } from "@/system/statistics/StatTypes";
import type Authority from "@/modules/Authority";
import type Rules from "@/modules/Rules";
import type Statistics from "@/modules/Statistics";

const props = defineProps<{ member?: number }>();
const { version, touch, core } = useBcpVersion();
const now = useNow();

const statistics = core.ModuleManager.getModule<Statistics>("statistics")!;
const local = props.member === undefined;
const character = bcpCharacter(props.member);
const dead = computed(() => {
    version.value;
    return !local && (character === null || bcpCharacter(props.member) === null);
});

onMounted(() => {
    if (!character) {
        return;
    }
    const cached = statistics.getRemoteStats(character.MemberNumber);
    // Denials and timeouts are retried on open - permissions may have
    // changed since (a cached denial otherwise sticks for the session)
    if (cached === undefined || cached === "denied" || cached === "timeout") {
        statistics.requestStats(character.MemberNumber);
    }
});

const remoteState = computed(() => {
    version.value;
    if (local || !character) {
        return null;
    }
    return statistics.getRemoteStats(character.MemberNumber) ?? "pending";
});

const canView = computed(() => {
    version.value;
    return local ? statistics.canView() : true;
});
const canReset = computed(() => {
    version.value;
    if (local) {
        return statistics.canReset();
    }
    const authority = core.ModuleManager.getModule<Authority>("authority");
    return character !== null && (authority?.remoteHasPermission(character, "stats.reset") ?? false);
});
const stats = computed(() => {
    version.value;
    if (local) {
        // peek, not snapshot: a computed must not flush-to-Data (that made
        // every sync event trigger a server save while this page was open)
        return canView.value ? statistics.peekSnapshot() : null;
    }
    const fetched = remoteState.value;
    return typeof fetched === "object" && fetched !== null ? fetched : null;
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
        if (local) {
            statistics.resetStats();
        } else if (character) {
            statistics.requestReset(character.MemberNumber);
        }
        resetArmedUntil.value = 0;
        touch();
    } else {
        resetArmedUntil.value = Date.now() + 5_000;
    }
}

function refresh(): void {
    if (character) {
        statistics.requestStats(character.MemberNumber);
        touch();
    }
}
</script>

<template>
    <p v-if="dead" class="text-fg-dim">They are no longer in this room.</p>
    <div v-else class="flex h-full flex-col gap-3">
        <p v-if="local && !canView" class="px-2 text-fg-dim">You are not permitted to view your own statistics.</p>
        <p v-else-if="remoteState === 'pending'" class="px-2 text-fg-dim">Requesting statistics...</p>
        <div v-else-if="remoteState === 'denied' || remoteState === 'timeout'" class="flex flex-wrap items-center gap-3 px-2">
            <p class="text-fg-dim">
                {{ remoteState === 'denied'
                    ? `${character!.Nickname} does not permit you to view their statistics.`
                    : "No response - they may be busy, disconnected, or running an older BC+." }}
            </p>
            <button
                class="rounded-lg bg-surface px-3 py-1.5 hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                @click="refresh()"
            >Try again</button>
        </div>
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

            <div v-if="canReset || !local" class="flex gap-2 border-t pt-3" style="border-color: var(--bcp-border);">
                <button
                    v-if="canReset"
                    class="rounded-lg px-4 py-2"
                    :style="now < resetArmedUntil
                        ? 'background: rgba(224,82,82,0.25); border: 1px solid #e05252; color: #e05252;'
                        : 'background: var(--bcp-surface); border: 1px solid var(--bcp-border);'"
                    :title="local ? 'Wipes all counters and starts over' : 'Wipes their counters (their client validates)'"
                    @click="resetStats()"
                >{{ now < resetArmedUntil ? "Confirm reset" : "Reset stats" }}</button>
                <button
                    v-if="!local"
                    class="rounded-lg bg-surface px-4 py-2 hover:bg-surface-hover"
                    style="border: 1px solid var(--bcp-border);"
                    title="Request their latest numbers"
                    @click="refresh()"
                >Refresh</button>
            </div>
        </template>
    </div>
</template>
