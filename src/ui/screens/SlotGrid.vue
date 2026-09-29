<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { BCPLUS_KEY } from "@/ui/nav";
import { isBodyGroup } from "@/modules/Curses";
import type Curses from "@/modules/Curses";

const props = defineProps<{
    /** Explains what clicking a slot does in this context. */
    note: string;
    /** Disabled state + hover for one slot, plus an optional color-coding tint. */
    slotState: (group: AssetGroup) => { disabled: boolean; hover: string; tint?: "cursed" | "worn" | "empty" };
    /** Called with the chosen group name. */
    pick: (group: AssetGroupName) => void;
}>();

/** Color-coding so busy and empty slots read at a glance (no tint = plain). */
function slotStyle(tint: "cursed" | "worn" | "empty" | undefined): string {
    switch (tint) {
        case "cursed":
            return "border: 1px solid var(--bcp-accent); background: color-mix(in srgb, var(--bcp-accent) 14%, var(--bcp-surface));";
        case "worn":
            return "border: 1px solid #58a360; background: color-mix(in srgb, #58a360 12%, var(--bcp-surface));";
        default:
            return "border: 1px solid var(--bcp-border);";
    }
}

const core = inject(BCPLUS_KEY)!;
const category = ref<"Item" | "Clothing" | "Body">("Item");

const groups = computed(() => {
    const all = core.ModuleManager.getModule<Curses>("curses")?.curseableGroups() ?? [];
    return all.filter((g) =>
        category.value === "Item" ? g.Category === "Item"
        : category.value === "Clothing" ? g.Category === "Appearance" && g.Clothing
        : isBodyGroup(g));
});
</script>

<template>
    <div class="flex h-full flex-col gap-3">
        <p class="text-sm text-fg-dim">{{ note }}</p>
        <div class="flex gap-1.5">
            <button
                v-for="tab in ([['Item', 'Items'], ['Clothing', 'Clothing'], ['Body', 'Body']] as const)"
                :key="tab[0]"
                class="rounded-full px-4 py-1"
                :style="category === tab[0]
                    ? 'background: var(--bcp-accent); color: var(--bcp-on-accent);'
                    : 'background: var(--bcp-surface); border: 1px solid var(--bcp-border);'"
                @click="category = tab[0]"
            >{{ tab[1] }}</button>
        </div>
        <div class="grid min-h-0 flex-1 grid-cols-2 content-start gap-2 overflow-y-auto md:grid-cols-3">
            <button
                v-for="group in groups"
                :key="group.Name"
                class="rounded-lg bg-surface px-3 py-2 text-left hover:bg-surface-hover disabled:opacity-50"
                :style="slotStyle(slotState(group).tint)"
                :disabled="slotState(group).disabled"
                :title="slotState(group).hover"
                @click="pick(group.Name)"
            >
                <span class="block truncate font-semibold">{{ group.Description }}</span>
                <span class="block truncate text-xs text-fg-dim">{{ slotState(group).hover }}</span>
            </button>
        </div>
    </div>
</template>
