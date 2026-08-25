<script setup lang="ts">
import { computed, inject, onMounted, ref } from "vue";
import { NAV_KEY } from "@/ui/nav";
import { bcpCharacter, useBcpVersion } from "@/ui/composables";
import ModuleSettings from "@/ui/screens/ModuleSettings.vue";
import { formatLogTime } from "@/system/logging/LogTypes";
import { MemberNumberToName, SendBCPMessage } from "@/utils/Messaging";
import type Authority from "@/modules/Authority";
import type Logging from "@/modules/Logging";

const props = defineProps<{ member?: number }>();
const nav = inject(NAV_KEY)!;
const { version, touch, core } = useBcpVersion();

const logging = core.ModuleManager.getModule<Logging>("logging")!;
const authority = core.ModuleManager.getModule<Authority>("authority");
const local = props.member === undefined;
const character = bcpCharacter(props.member);
const dead = !local && character === null;

onMounted(() => {
    if (character && logging.getRemoteLog(character.MemberNumber) === undefined) {
        logging.requestLog(character.MemberNumber);
    }
});

/** Remote request state; null while local. */
const remoteState = computed(() => {
    version.value;
    if (local || !character) {
        return null;
    }
    const fetched = logging.getRemoteLog(character.MemberNumber);
    return fetched === undefined ? "pending" : fetched;
});

const canView = computed(() => {
    version.value;
    return local ? logging.canView() : true;
});
const canClear = computed(() => {
    version.value;
    if (local) {
        return logging.canClear();
    }
    return character !== null && (authority?.remoteHasPermission(character, "log.delete") ?? false);
});
const canPraise = computed(() => {
    version.value;
    return character !== null && (authority?.remoteHasPermission(character, "log.praise") ?? false);
});
const canNote = computed(() => {
    version.value;
    return character !== null && (authority?.remoteHasPermission(character, "log.note") ?? false);
});

const entries = computed(() => {
    version.value;
    if (local) {
        return [...logging.Entries].reverse();
    }
    const fetched = remoteState.value;
    return Array.isArray(fetched) ? [...fetched].reverse() : [];
});

/** Two-click confirm for the clear button. */
const clearArmedUntil = ref(0);
function clearLog(): void {
    if (Date.now() < clearArmedUntil.value) {
        if (local) {
            logging.clear();
        } else if (character) {
            logging.requestClear(character.MemberNumber);
        }
        clearArmedUntil.value = 0;
        touch();
    } else {
        clearArmedUntil.value = Date.now() + 5_000;
    }
}

function openConfigure(): void {
    nav.push({ component: ModuleSettings, title: "Log recording", props: { slug: "logging" } });
}

// --- Praise / scold / note on someone else's log ---
const entryKind = ref<"praise" | "scold" | "note" | null>(null);
const entryDraft = ref("");
function startEntry(kind: "praise" | "scold" | "note"): void {
    entryKind.value = entryKind.value === kind ? null : kind;
    entryDraft.value = "";
}
function sendEntry(): void {
    const kind = entryKind.value;
    const text = entryDraft.value.trim();
    if (!kind || !character || (kind === "note" && text.length === 0)) {
        return;
    }
    SendBCPMessage({ message: "LogAdd", kind, text }, character.MemberNumber);
    entryKind.value = null;
    entryDraft.value = "";
    // Their fresh log is pushed after the add; re-request to be sure
    logging.requestLog(character.MemberNumber);
}
</script>

<template>
    <p v-if="dead" class="text-fg-dim">They are no longer in this room.</p>
    <div v-else class="flex h-full flex-col gap-3">
        <p v-if="local && !canView" class="px-2 text-fg-dim">You are not permitted to view your own log.</p>
        <p v-else-if="remoteState === 'pending'" class="px-2 text-fg-dim">Requesting log...</p>
        <p v-else-if="remoteState === 'denied'" class="px-2 text-fg-dim">
            {{ character!.Nickname }} does not permit you to view their log.
        </p>
        <p v-else-if="remoteState === 'timeout'" class="px-2 text-fg-dim">
            No response - they may be busy, disconnected, or running an older BC+.
        </p>
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

        <div v-if="!local && entryKind" class="flex items-center gap-2 px-2">
            <span class="capitalize">{{ entryKind }}:</span>
            <input
                v-model="entryDraft"
                type="text" class="flex-1" maxlength="200"
                :placeholder="entryKind === 'note' ? 'Note text...' : 'Optional message...'"
                @keydown.enter.prevent="sendEntry()"
            >
            <button
                class="rounded-lg px-4 py-1.5 font-semibold"
                style="background: var(--bcp-accent); color: var(--bcp-on-accent);"
                @click="sendEntry()"
            >Send</button>
        </div>

        <div class="flex flex-wrap items-center gap-2 border-t pt-3" style="border-color: var(--bcp-border);">
            <template v-if="local">
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
            </template>
            <template v-else>
                <button
                    class="rounded-lg bg-surface px-3 py-2 hover:bg-surface-hover disabled:opacity-50"
                    style="border: 1px solid var(--bcp-border);"
                    :disabled="!canPraise"
                    title="Add a praise entry to their log"
                    @click="startEntry('praise')"
                >Praise</button>
                <button
                    class="rounded-lg bg-surface px-3 py-2 hover:bg-surface-hover disabled:opacity-50"
                    style="border: 1px solid var(--bcp-border);"
                    :disabled="!canPraise"
                    title="Add a scold entry to their log"
                    @click="startEntry('scold')"
                >Scold</button>
                <button
                    class="rounded-lg bg-surface px-3 py-2 hover:bg-surface-hover disabled:opacity-50"
                    style="border: 1px solid var(--bcp-border);"
                    :disabled="!canNote"
                    title="Attach a note to their log"
                    @click="startEntry('note')"
                >Leave note</button>
                <span class="flex-1"></span>
                <button
                    class="rounded-lg px-4 py-2 disabled:opacity-50"
                    :style="Date.now() < clearArmedUntil
                        ? 'background: rgba(224,82,82,0.25); border: 1px solid #e05252; color: #e05252;'
                        : 'background: var(--bcp-surface); border: 1px solid var(--bcp-border);'"
                    :disabled="!canClear"
                    :title="`Removes all entries from ${MemberNumberToName(props.member!)}'s log (their client validates)`"
                    @click="clearLog()"
                >{{ Date.now() < clearArmedUntil ? "Confirm clear" : "Clear log" }}</button>
            </template>
        </div>
    </div>
</template>
