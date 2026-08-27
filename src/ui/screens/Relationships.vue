<script setup lang="ts">
import { computed, inject, onMounted, ref } from "vue";
import { bcpCharacter, useBcpVersion } from "@/ui/composables";
import { PICKER_KEY } from "@/ui/picker";
import { MemberNumberToName } from "@/utils/Messaging";
import { NICKNAME_MAX, isValidCustomName } from "@/modules/Relationships";
import type Authority from "@/modules/Authority";
import type Relationships from "@/modules/Relationships";

const props = defineProps<{ member?: number }>();
const picker = inject(PICKER_KEY)!;
const { version, touch, core } = useBcpVersion();

const relationships = core.ModuleManager.getModule<Relationships>("relationships")!;
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
    const cached = relationships.getRemoteEntries(character.MemberNumber);
    // Denials and timeouts are retried on open - permissions may have
    // changed since (a cached denial otherwise sticks for the session)
    if (cached === undefined || cached === "denied" || cached === "timeout") {
        relationships.requestEntries(character.MemberNumber);
    }
});

const remoteState = computed(() => {
    version.value;
    if (local || !character) {
        return null;
    }
    return relationships.getRemoteEntries(character.MemberNumber) ?? "pending";
});

const canEdit = computed(() => {
    version.value;
    if (local) {
        return relationships.canEdit();
    }
    const authority = core.ModuleManager.getModule<Authority>("authority");
    return character !== null && (authority?.remoteHasPermission(character, "relationships.edit") ?? false);
});

const entriesMap = computed(() => {
    version.value;
    if (local) {
        return relationships.Entries;
    }
    const fetched = remoteState.value;
    return typeof fetched === "object" && fetched !== null ? fetched : {};
});

const rows = computed(() => {
    version.value;
    return Object.entries(entriesMap.value)
        .map(([key, entry]) => ({ member: Number.parseInt(key, 10), entry }))
        .filter((row) => Number.isInteger(row.member))
        .sort((a, b) => a.member - b.member);
});

const invalidName = ref<number | null>(null);

/** Local writes apply directly; remote ones are commands their client validates. */
function storeEntry(member: number, nickname: string, enforce: boolean): void {
    if (local) {
        relationships.setEntry(member, nickname, enforce);
    } else if (character) {
        relationships.requestSet(character.MemberNumber, member, nickname, enforce);
    }
    touch();
}

function commitName(member: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const name = input.value.trim();
    const entry = entriesMap.value[String(member)];
    if (!entry || name === entry.nickname) {
        return;
    }
    if (!isValidCustomName(name)) {
        invalidName.value = member;
        input.value = entry.nickname;
        return;
    }
    invalidName.value = null;
    storeEntry(member, name, entry.enforce);
}

function toggleEnforce(member: number): void {
    const entry = entriesMap.value[String(member)];
    if (entry && canEdit.value) {
        storeEntry(member, entry.nickname, !entry.enforce);
    }
}

function remove(member: number): void {
    if (local) {
        relationships.removeEntry(member);
    } else if (character) {
        relationships.requestRemove(character.MemberNumber, member);
    }
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
    if (entriesMap.value[String(member)]) {
        return;
    }
    const seeded = MemberNumberToName(member, "Pet").slice(0, NICKNAME_MAX);
    storeEntry(member, isValidCustomName(seeded) ? seeded : "Pet", false);
}

function browse(): void {
    void picker.pickPerson({
        title: "Custom name for...",
        excluded: rows.value.map((row) => row.member),
    }).then((member) => {
        if (member !== null) {
            startEntry(member);
        }
    });
}
</script>

<template>
    <p v-if="dead" class="text-fg-dim">They are no longer in this room.</p>
    <div v-else-if="remoteState === 'pending'" class="px-2 text-fg-dim">Requesting their relationship list...</div>
    <div v-else-if="remoteState === 'denied' || remoteState === 'timeout'" class="flex flex-wrap items-center gap-3 px-2">
        <p class="text-fg-dim">
            {{ remoteState === 'denied'
                ? `${character!.Nickname} does not permit you to view their relationships.`
                : "No response - they may be busy, disconnected, or running an older BC+." }}
        </p>
        <button
            class="rounded-lg bg-surface px-3 py-1.5 hover:bg-surface-hover"
            style="border: 1px solid var(--bcp-border);"
            @click="relationships.requestEntries(character!.MemberNumber); touch()"
        >Try again</button>
    </div>
    <div v-else class="flex h-full flex-col gap-3">
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
