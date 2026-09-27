<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { WINDOW_KEY } from "@/ui/nav";
import { useBcpVersion, useNow } from "@/ui/composables";
import type RoomTemplates from "@/modules/RoomTemplates";
import { MAX_TEMPLATES } from "@/modules/RoomTemplates";

const { version, touch, core } = useBcpVersion();
const now = useNow();
const uiWindow = inject(WINDOW_KEY)!;

const rooms = core.ModuleManager.getModule<RoomTemplates>("rooms")!;

const templates = computed(() => {
    version.value;
    return rooms.Templates.map((template, index) => ({ template, index }));
});

const inRoom = computed(() => {
    version.value;
    return ServerPlayerIsInChatRoom();
});

/** BC's room create/update screen is behind the window (the now tick keeps this fresh). */
const adminOpen = computed(() => {
    now.value;
    return rooms.adminScreenOpen();
});

function fillForm(index: number): void {
    if (rooms.applyToAdminForm(index)) {
        uiWindow.close();
    }
}

const error = ref<string | null>(null);

/** Two-click confirm state for destructive row actions. */
const armed = ref<{ action: "delete" | "update"; index: number; until: number } | null>(null);

function isArmed(action: "delete" | "update", index: number): boolean {
    const current = armed.value;
    return current !== null && current.action === action && current.index === index && now.value < current.until;
}

function saveCurrent(): void {
    error.value = rooms.captureCurrentRoom();
    touch();
}

function updateFromRoom(index: number): void {
    if (isArmed("update", index)) {
        error.value = rooms.captureCurrentRoom(index);
        armed.value = null;
        touch();
    } else {
        armed.value = { action: "update", index, until: Date.now() + 5_000 };
    }
}

function remove(index: number): void {
    if (isArmed("delete", index)) {
        rooms.removeTemplate(index);
        armed.value = null;
        touch();
    } else {
        armed.value = { action: "delete", index, until: Date.now() + 5_000 };
    }
}

function move(index: number, direction: -1 | 1): void {
    rooms.moveTemplate(index, direction);
    armed.value = null;
    touch();
}

function visit(index: number): void {
    void rooms.visit(index);
}

function metaLine(entry: (typeof templates.value)[number]): string {
    const room = entry.template.room;
    const parts: string[] = [];
    if (typeof room.Limit === "number") {
        parts.push(`${room.Limit} slots`);
    }
    if (Array.isArray(room.Visibility) && !room.Visibility.includes("All")) {
        parts.push("hidden");
    }
    if (Array.isArray(room.Access) && !room.Access.includes("All")) {
        parts.push("locked");
    }
    if (room.MapData !== undefined) {
        parts.push("map");
    }
    parts.push(`saved ${new Date(entry.template.savedAt).toLocaleDateString()}`);
    return parts.join(" · ");
}
</script>

<template>
    <div class="mx-auto flex max-w-3xl flex-col gap-3">
        <p class="px-3 text-sm text-fg-dim">
            Templates snapshot a room's full setup. <strong>Go</strong> joins the room when it
            exists and recreates it from the snapshot when it does not - also available as
            <code>/bcp room &lt;name&gt;</code>. On BC's room creation screen, the BC+ button
            on the background preview opens this page and <strong>Fill form</strong> loads a
            template into the form instead.
        </p>

        <div class="flex items-center gap-3 px-3">
            <button
                class="rounded-lg bg-surface px-4 py-2 hover:bg-surface-hover disabled:opacity-50"
                style="border: 1px solid var(--bcp-border);"
                :disabled="!inRoom || templates.length >= MAX_TEMPLATES"
                :title="inRoom ? 'Snapshot the room you are in as a new template' : 'Enter a chat room first'"
                @click="saveCurrent()"
            >Save current room</button>
            <span class="text-sm text-fg-dim">{{ templates.length }} / {{ MAX_TEMPLATES }}</span>
        </div>
        <p v-if="error" class="px-3 text-sm" style="color: #e05252;">{{ error }}</p>

        <p v-if="templates.length === 0" class="px-3 text-fg-dim">
            No templates yet - enter one of your rooms and save it.
        </p>
        <div v-else class="flex flex-col gap-0.5">
            <div
                v-for="entry in templates"
                :key="`${entry.template.room.Name}-${entry.index}`"
                class="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface"
            >
                <div class="min-w-0 flex-1">
                    <div class="truncate font-semibold">{{ entry.template.room.Name }}</div>
                    <div class="truncate text-sm text-fg-dim">{{ metaLine(entry) }}</div>
                </div>
                <div class="flex flex-col">
                    <button
                        class="px-1 text-fg-dim hover:text-accent disabled:opacity-30"
                        :disabled="entry.index === 0"
                        title="Move up"
                        @click="move(entry.index, -1)"
                    >&#9650;</button>
                    <button
                        class="px-1 text-fg-dim hover:text-accent disabled:opacity-30"
                        :disabled="entry.index === templates.length - 1"
                        title="Move down"
                        @click="move(entry.index, 1)"
                    >&#9660;</button>
                </div>
                <button
                    class="rounded-lg bg-surface px-3 py-1.5 hover:bg-surface-hover disabled:opacity-50"
                    style="border: 1px solid var(--bcp-border);"
                    :disabled="!inRoom"
                    :title="inRoom ? 'Overwrite this template with the room you are in' : 'Enter a chat room first'"
                    @click="updateFromRoom(entry.index)"
                >{{ isArmed("update", entry.index) ? "Overwrite?" : "Update" }}</button>
                <button
                    v-if="adminOpen"
                    class="rounded-lg px-3 py-1.5"
                    style="border: 1px solid var(--bcp-accent); color: var(--bcp-accent-fg, var(--bcp-accent));"
                    title="Fill the room form behind this window from this template"
                    @click="fillForm(entry.index)"
                >Fill form</button>
                <button
                    class="rounded-lg px-4 py-1.5"
                    :style="adminOpen
                        ? 'border: 1px solid var(--bcp-border); color: var(--bcp-text);'
                        : 'border: 1px solid var(--bcp-accent); color: var(--bcp-accent-fg, var(--bcp-accent));'"
                    title="Join this room, or recreate it if it does not exist"
                    @click="visit(entry.index)"
                >Go</button>
                <button
                    class="rounded px-2 py-1"
                    :style="isArmed('delete', entry.index)
                        ? 'color: #e05252; border: 1px solid #e05252; border-radius: 6px;'
                        : 'color: var(--bcp-text-dim);'"
                    :title="isArmed('delete', entry.index) ? 'Click again to delete' : 'Delete this template'"
                    @click="remove(entry.index)"
                >&#10005;</button>
            </div>
        </div>
    </div>
</template>
