<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { NAV_KEY } from "@/ui/nav";
import { useBcpVersion } from "@/ui/composables";
import PersonPicker from "@/ui/screens/PersonPicker.vue";
import { MemberNumberToName } from "@/utils/Messaging";
import { NICKNAME_MAX, isValidCustomName } from "@/modules/Relationships";
import type Relationships from "@/modules/Relationships";

const nav = inject(NAV_KEY)!;
const { version, touch, core } = useBcpVersion();

const relationships = core.ModuleManager.getModule<Relationships>("relationships")!;

const canEdit = computed(() => {
    version.value;
    return relationships.canEdit();
});

const rows = computed(() => {
    version.value;
    return Object.entries(relationships.Entries)
        .map(([key, entry]) => ({ member: Number.parseInt(key, 10), entry }))
        .filter((row) => Number.isInteger(row.member))
        .sort((a, b) => a.member - b.member);
});

const invalidName = ref<number | null>(null);

function commitName(member: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const name = input.value.trim();
    const entry = relationships.Entries[String(member)];
    if (!entry || name === entry.nickname) {
        return;
    }
    if (!isValidCustomName(name)) {
        invalidName.value = member;
        input.value = entry.nickname;
        return;
    }
    invalidName.value = null;
    relationships.setEntry(member, name, entry.enforce);
    touch();
}

function toggleEnforce(member: number): void {
    const entry = relationships.Entries[String(member)];
    if (entry && canEdit.value) {
        relationships.setEntry(member, entry.nickname, !entry.enforce);
        touch();
    }
}

function remove(member: number): void {
    relationships.removeEntry(member);
    touch();
}

const addDraft = ref("");
function addByNumber(): void {
    const member = Number.parseInt(addDraft.value.trim(), 10);
    if (Number.isInteger(member) && member >= 0) {
        startEntry(member);
    }
    addDraft.value = "";
}

/** Seeds an entry with the member's known name; edit inline from there. */
function startEntry(member: number): void {
    if (relationships.Entries[String(member)]) {
        return;
    }
    const seeded = MemberNumberToName(member, "Pet").slice(0, NICKNAME_MAX);
    relationships.setEntry(member, isValidCustomName(seeded) ? seeded : "Pet", false);
    touch();
}

function browse(): void {
    nav.push({
        component: PersonPicker,
        title: "Custom name for...",
        props: {
            excluded: rows.value.map((row) => row.member),
            onPick: (member: number) => startEntry(member),
        },
    });
}
</script>

<template>
    <div class="flex h-full flex-col gap-3">
        <p v-if="rows.length === 0" class="px-2 text-fg-dim">No custom names set.</p>
        <div v-else class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
            <div class="flex items-center gap-3 px-3 pb-1 text-sm text-fg-dim">
                <span class="min-w-0 flex-1">Member</span>
                <span class="w-56">Custom name</span>
                <span class="w-24 text-center" title="Whether using their real name in chat is blocked">Must use it</span>
                <span class="w-8"></span>
            </div>
            <div
                v-for="row in rows"
                :key="row.member"
                class="flex items-center gap-3 rounded-lg px-3 py-1.5 hover:bg-surface"
            >
                <span class="min-w-0 flex-1 truncate">{{ MemberNumberToName(row.member) }} (#{{ row.member }})</span>
                <input
                    type="text" class="w-56" :maxlength="NICKNAME_MAX"
                    :disabled="!canEdit"
                    :value="row.entry.nickname"
                    @change="commitName(row.member, $event)"
                >
                <span class="flex w-24 justify-center">
                    <input
                        type="checkbox" class="h-5 w-5" style="accent-color: var(--bcp-accent);"
                        :checked="row.entry.enforce" :disabled="!canEdit"
                        @change="toggleEnforce(row.member)"
                    >
                </span>
                <button
                    v-if="canEdit"
                    class="w-8 rounded px-1 text-fg-dim hover:text-accent"
                    title="Remove this custom name"
                    @click="remove(row.member)"
                >&#10005;</button>
            </div>
        </div>
        <p v-if="invalidName !== null" class="px-3 text-sm" style="color: #e05252;">
            That is not a usable name (1-{{ NICKNAME_MAX }} characters, like a BC nickname).
        </p>

        <div v-if="canEdit" class="flex items-center gap-2 border-t pt-3" style="border-color: var(--bcp-border);">
            <input
                v-model="addDraft"
                type="text" inputmode="numeric" class="w-44"
                placeholder="Member number..."
                @keydown.enter.prevent="addByNumber()"
            >
            <button
                class="rounded-lg bg-surface px-3 py-1.5 hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                @click="addByNumber()"
            >Add</button>
            <button
                class="rounded-lg bg-surface px-3 py-1.5 hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                title="Pick from room, friends and relationships"
                @click="browse()"
            >Browse...</button>
        </div>
    </div>
</template>
