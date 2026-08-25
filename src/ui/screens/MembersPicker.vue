<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { NAV_KEY } from "@/ui/nav";
import { collectMemberCandidates } from "@/utils/MemberSelect";
import { MemberNumberToName } from "@/utils/Messaging";

const props = defineProps<{
    /** Currently selected member numbers. */
    initial: number[];
    /** Called with the final selection when Done is clicked. */
    onDone: (members: number[]) => void;
}>();

const nav = inject(NAV_KEY)!;

const selected = ref<number[]>([...props.initial]);
const manualDraft = ref("");

const candidates = computed(() => collectMemberCandidates());

/** Selected members that are not in the candidate list (manual entries). */
const extraSelected = computed(() =>
    selected.value.filter((m) => !candidates.value.some((c) => c.memberNumber === m)));

function toggle(memberNumber: number): void {
    const index = selected.value.indexOf(memberNumber);
    if (index >= 0) {
        selected.value.splice(index, 1);
    } else {
        selected.value.push(memberNumber);
    }
}

function addManual(): void {
    const parsed = Number.parseInt(manualDraft.value.trim(), 10);
    if (Number.isInteger(parsed) && parsed >= 0 && !selected.value.includes(parsed)) {
        selected.value.push(parsed);
    }
    manualDraft.value = "";
}

function done(): void {
    props.onDone([...selected.value]);
    nav.pop();
}
</script>

<template>
    <div class="mx-auto flex max-w-2xl flex-col gap-3">
        <div class="flex flex-col gap-1">
            <label
                v-for="candidate in candidates"
                :key="candidate.memberNumber"
                class="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface"
            >
                <input
                    type="checkbox"
                    class="h-5 w-5"
                    style="accent-color: var(--bcp-accent);"
                    :checked="selected.includes(candidate.memberNumber)"
                    @change="toggle(candidate.memberNumber)"
                >
                <span class="min-w-0 flex-1 truncate">{{ candidate.name }} (#{{ candidate.memberNumber }})</span>
                <span class="shrink-0 text-sm text-fg-dim">{{ candidate.note }}</span>
            </label>
            <p v-if="candidates.length === 0" class="px-3 text-fg-dim">
                Nobody to suggest right now - add member numbers by hand below.
            </p>
        </div>

        <div v-if="extraSelected.length > 0" class="flex flex-wrap gap-1.5 px-3">
            <span
                v-for="member in extraSelected"
                :key="member"
                class="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-0.5 text-sm"
                style="border: 1px solid var(--bcp-border);"
            >
                {{ MemberNumberToName(member) }} (#{{ member }})
                <button class="text-fg-dim hover:text-accent" title="Remove" @click="toggle(member)">&#10005;</button>
            </span>
        </div>

        <div class="flex items-center gap-2 px-3">
            <input
                v-model="manualDraft"
                type="text"
                inputmode="numeric"
                class="w-44"
                placeholder="Member number..."
                @keydown.enter.prevent="addManual()"
            >
            <button
                class="rounded-lg bg-surface px-3 py-1.5 hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                @click="addManual()"
            >Add</button>
            <span class="flex-1"></span>
            <button
                class="rounded-lg px-4 py-1.5 font-semibold"
                style="background: var(--bcp-accent); color: var(--bcp-on-accent);"
                @click="done()"
            >Done ({{ selected.length }})</button>
        </div>
    </div>
</template>
