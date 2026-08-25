<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { NAV_KEY } from "@/ui/nav";
import { collectMemberCandidates } from "@/gui/UserSelectScreen";

const props = defineProps<{
    /** Called with the chosen member; the picker pops itself. */
    onPick: (memberNumber: number) => void;
    /** Members not offered (already assigned etc.). */
    excluded?: number[];
}>();

const nav = inject(NAV_KEY)!;
const manualDraft = ref("");

const candidates = computed(() => collectMemberCandidates(props.excluded ?? []));

function choose(memberNumber: number): void {
    props.onPick(memberNumber);
    nav.pop();
}

function chooseManual(): void {
    const parsed = Number.parseInt(manualDraft.value.trim(), 10);
    if (Number.isInteger(parsed) && parsed >= 0) {
        choose(parsed);
    }
}
</script>

<template>
    <div class="mx-auto flex max-w-2xl flex-col gap-3">
        <div class="flex flex-col gap-0.5">
            <button
                v-for="candidate in candidates"
                :key="candidate.memberNumber"
                class="flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface"
                @click="choose(candidate.memberNumber)"
            >
                <span class="min-w-0 flex-1 truncate">{{ candidate.name }} (#{{ candidate.memberNumber }})</span>
                <span class="shrink-0 text-sm text-fg-dim">{{ candidate.note }}</span>
            </button>
            <p v-if="candidates.length === 0" class="px-3 text-fg-dim">
                Nobody to suggest right now - enter a member number below.
            </p>
        </div>
        <div class="flex items-center gap-2 px-3">
            <input
                v-model="manualDraft"
                type="text"
                inputmode="numeric"
                class="w-44"
                placeholder="Member number..."
                @keydown.enter.prevent="chooseManual()"
            >
            <button
                class="rounded-lg bg-surface px-3 py-1.5 hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                @click="chooseManual()"
            >Pick</button>
        </div>
    </div>
</template>
