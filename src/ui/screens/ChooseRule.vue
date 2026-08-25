<script setup lang="ts">
import { computed, inject } from "vue";
import { BCPLUS_KEY, NAV_KEY } from "@/ui/nav";
import type Rules from "@/modules/Rules";

const props = defineProps<{
    /** Called with the chosen rule id; the chooser pops itself. */
    pick: (ruleId: string) => void;
}>();

const core = inject(BCPLUS_KEY)!;
const nav = inject(NAV_KEY)!;

const sorted = computed(() => {
    const definitions = core.ModuleManager.getModule<Rules>("rules")?.Definitions ?? [];
    return [...definitions].sort((a, b) => (a.category === b.category
        ? a.name.localeCompare(b.name)
        : a.category.localeCompare(b.category)));
});

function choose(id: string): void {
    props.pick(id);
    nav.pop();
}
</script>

<template>
    <div class="flex flex-col gap-0.5">
        <p class="px-3 pb-2 text-sm text-fg-dim">
            Pick the rule this punishment forces. While the punishment runs, the rule is active,
            enforced and unconditional (its own conditions are ignored), and cannot be switched
            off; when the punishment ends, the rule returns to how it was before.
        </p>
        <button
            v-for="rule in sorted"
            :key="rule.id"
            class="flex items-baseline gap-2 rounded-lg px-3 py-2 text-left hover:bg-surface"
            @click="choose(rule.id)"
        >
            <span class="min-w-0 flex-1 truncate">{{ rule.name }}</span>
            <span class="text-xs text-fg-dim">{{ rule.category }}</span>
        </button>
    </div>
</template>
