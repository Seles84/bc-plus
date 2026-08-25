<script setup lang="ts">
import { computed, ref } from "vue";
import BcpModal from "@/ui/components/BcpModal.vue";
import { collectMemberCandidates } from "@/utils/MemberSelect";
import { MemberNumberToName } from "@/utils/Messaging";
import type { PickerRequest } from "@/ui/picker";

const props = defineProps<{ request: PickerRequest }>();

const emit = defineEmits<{
    /** The final choice, or null when dismissed. */
    finish: [result: number[] | null];
}>();

const search = ref("");
const manualDraft = ref("");
const selected = ref<number[]>([...props.request.initial]);

const candidates = computed(() => {
    const term = search.value.trim().toLocaleLowerCase();
    return collectMemberCandidates(props.request.excluded).filter((candidate) =>
        term.length === 0
        || candidate.name.toLocaleLowerCase().includes(term)
        || String(candidate.memberNumber).includes(term));
});

/** Selected members not in the candidate list (manual entries, offline). */
const extraSelected = computed(() =>
    selected.value.filter((m) => !collectMemberCandidates(props.request.excluded).some((c) => c.memberNumber === m)));

function choose(memberNumber: number): void {
    if (!props.request.multi) {
        emit("finish", [memberNumber]);
        return;
    }
    const index = selected.value.indexOf(memberNumber);
    if (index >= 0) {
        selected.value.splice(index, 1);
    } else {
        selected.value.push(memberNumber);
    }
}

function chooseManual(): void {
    const parsed = Number.parseInt(manualDraft.value.trim(), 10);
    manualDraft.value = "";
    if (Number.isInteger(parsed) && parsed >= 0) {
        if (props.request.multi && selected.value.includes(parsed)) {
            return;
        }
        choose(parsed);
    }
}
</script>

<template>
    <BcpModal :title="request.title" @close="emit('finish', null)">
        <div class="flex flex-col gap-2">
            <input
                v-model="search"
                type="text"
                placeholder="Search by name or number..."
                class="w-full"
            >
            <div class="flex flex-col gap-0.5">
                <template v-if="request.multi">
                    <label
                        v-for="candidate in candidates"
                        :key="candidate.memberNumber"
                        class="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5 hover:bg-surface"
                    >
                        <input
                            type="checkbox" class="h-5 w-5" style="accent-color: var(--bcp-accent);"
                            :checked="selected.includes(candidate.memberNumber)"
                            @change="choose(candidate.memberNumber)"
                        >
                        <span class="min-w-0 flex-1 truncate">{{ candidate.name }} (#{{ candidate.memberNumber }})</span>
                        <span class="shrink-0 text-sm text-fg-dim">{{ candidate.note }}</span>
                    </label>
                </template>
                <template v-else>
                    <button
                        v-for="candidate in candidates"
                        :key="candidate.memberNumber"
                        class="flex items-center gap-3 rounded-lg px-3 py-1.5 text-left hover:bg-surface"
                        @click="choose(candidate.memberNumber)"
                    >
                        <span class="min-w-0 flex-1 truncate">{{ candidate.name }} (#{{ candidate.memberNumber }})</span>
                        <span class="shrink-0 text-sm text-fg-dim">{{ candidate.note }}</span>
                    </button>
                </template>
                <p v-if="candidates.length === 0" class="px-3 text-fg-dim">
                    Nobody matches - add a member number by hand below.
                </p>
            </div>

            <div v-if="request.multi && extraSelected.length > 0" class="flex flex-wrap gap-1.5">
                <span
                    v-for="member in extraSelected"
                    :key="member"
                    class="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-0.5 text-sm"
                    style="border: 1px solid var(--bcp-border);"
                >
                    {{ MemberNumberToName(member) }} (#{{ member }})
                    <button class="text-fg-dim hover:text-accent" title="Remove" @click="choose(member)">&#10005;</button>
                </span>
            </div>
        </div>

        <template #footer>
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
            >{{ request.multi ? "Add" : "Pick" }}</button>
            <span class="flex-1"></span>
            <button
                v-if="request.multi"
                class="rounded-lg px-4 py-1.5 font-semibold"
                style="background: var(--bcp-accent); color: var(--bcp-on-accent);"
                @click="emit('finish', [...selected])"
            >Done ({{ selected.length }})</button>
            <button
                class="rounded-lg bg-surface px-3 py-1.5 hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                @click="emit('finish', null)"
            >Cancel</button>
        </template>
    </BcpModal>
</template>
