<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { NAV_KEY } from "@/ui/nav";
import { useBcpVersion } from "@/ui/composables";
import ModuleSettings from "@/ui/screens/ModuleSettings.vue";
import { formatLogTime } from "@/system/logging/LogTypes";
import type Logging from "@/modules/Logging";

const nav = inject(NAV_KEY)!;
const { version, touch, core } = useBcpVersion();

const logging = core.ModuleManager.getModule<Logging>("logging")!;

const canView = computed(() => {
    version.value;
    return logging.canView();
});
const canClear = computed(() => {
    version.value;
    return logging.canClear();
});
const entries = computed(() => {
    version.value;
    return [...logging.Entries].reverse();
});

/** Two-click confirm for the clear button. */
const clearArmedUntil = ref(0);
function clearLog(): void {
    if (Date.now() < clearArmedUntil.value) {
        logging.clear();
        clearArmedUntil.value = 0;
        touch();
    } else {
        clearArmedUntil.value = Date.now() + 5_000;
    }
}

function openConfigure(): void {
    nav.push({ component: ModuleSettings, title: "Log recording", props: { slug: "logging" } });
}
</script>

<template>
    <div class="flex h-full flex-col gap-3">
        <p v-if="!canView" class="px-2 text-fg-dim">You are not permitted to view your own log.</p>
        <template v-else>
            <p v-if="entries.length === 0" class="px-2 text-fg-dim">The log is empty.</p>
            <div class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
                <div
                    v-for="(entry, index) in entries"
                    :key="`${entry.time}-${index}`"
                    class="flex items-baseline gap-3 rounded-lg px-3 py-1.5 hover:bg-surface"
                >
                    <span class="shrink-0 font-mono text-sm text-fg-dim">{{ formatLogTime(entry.time) }}</span>
                    <span class="shrink-0 text-sm text-fg-dim">[{{ entry.category }}]</span>
                    <span class="min-w-0 flex-1">{{ entry.message }}</span>
                </div>
            </div>
        </template>

        <div class="flex items-center gap-3 border-t pt-3" style="border-color: var(--bcp-border);">
            <button
                v-if="canClear && entries.length > 0"
                class="rounded-lg px-4 py-2"
                :style="Date.now() < clearArmedUntil
                    ? 'background: rgba(224,82,82,0.25); border: 1px solid #e05252; color: #e05252;'
                    : 'background: var(--bcp-surface); border: 1px solid var(--bcp-border);'"
                title="Removes all entries"
                @click="clearLog()"
            >{{ Date.now() < clearArmedUntil ? "Confirm clear" : "Clear log" }}</button>
            <button
                class="rounded-lg bg-surface px-4 py-2 hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                title="Choose which categories your log records (needs log.configure)"
                @click="openConfigure()"
            >Configure...</button>
        </div>
    </div>
</template>
