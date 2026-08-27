<script setup lang="ts">
import { computed, inject } from "vue";
import { NAV_KEY } from "@/ui/nav";
import { useBcpVersion } from "@/ui/composables";
import CurseSlot from "@/ui/screens/CurseSlot.vue";
import SlotGrid from "@/ui/screens/SlotGrid.vue";
import { LocalCurseAccess, RemoteCurseAccess } from "@/system/curses/CurseAccess";
import { CURSE_LOCKS } from "@/system/curses/CurseTypes";
import { bcpCharacter } from "@/ui/composables";
import type Authority from "@/modules/Authority";
import type Curses from "@/modules/Curses";

const props = defineProps<{ member?: number }>();
const nav = inject(NAV_KEY)!;
const { version, touch, core } = useBcpVersion();

const curses = core.ModuleManager.getModule<Curses>("curses")!;
const local = props.member === undefined;
const character = bcpCharacter(props.member);
const dead = computed(() => {
    version.value;
    return !local && bcpCharacter(props.member) === null;
});
const access = character
    ? new RemoteCurseAccess(curses, core.ModuleManager.getModule<Authority>("authority"), character)
    : new LocalCurseAccess(curses);

const canEdit = computed(() => {
    version.value;
    return access.canEdit();
});

const slots = computed(() => {
    version.value;
    return Object.values(access.slots());
});

function groupLabel(group: string): string {
    return curses.curseableGroups().find((g) => g.Name === group)?.Description ?? group;
}

function summary(slot: (typeof slots.value)[number]): string {
    const lockLabel = CURSE_LOCKS.find((l) => l.asset !== "" && l.asset === slot.lock)?.label;
    if (slot.items.length === 0) {
        return slot.allowEmpty ? "Cursed empty" : "Empty (inactive)";
    }
    return `${slot.items.length} allowed item${slot.items.length === 1 ? "" : "s"}${slot.allowEmpty ? ", may be empty" : ""}`
        + (lockLabel ? `, ${lockLabel.toLocaleLowerCase()}` : "");
}

function openSlot(group: string): void {
    nav.push({ component: CurseSlot, title: `Curse - ${groupLabel(group)}`, props: { group, member: props.member } });
}

function addCurse(): void {
    nav.push({
        component: SlotGrid,
        title: "Curse a slot",
        props: {
            note: "Click a slot to curse it. The slot's current state is captured: the worn item "
                + "becomes the first allowed item (in strict mode), an empty slot becomes cursed empty. "
                + "Slots that are already cursed are grayed out.",
            slotState: (group: AssetGroup) => {
                const cursed = access.slot(group.Name) !== undefined;
                if (cursed) {
                    return { disabled: true, hover: "Already cursed" };
                }
                const worn = InventoryGet(access.subject(), group.Name);
                return { disabled: false, hover: `Currently: ${worn ? (worn.Craft?.Name || worn.Asset.Description) : "empty"}` };
            },
            pick: (group: AssetGroupName) => {
                access.addCurse(group);
                touch();
                nav.pop();
                openSlot(group);
            },
        },
    });
}

const announce = computed(() => {
    version.value;
    return curses.Data.announce !== false;
});

function toggleAnnounce(): void {
    if (canEdit.value) {
        curses.Data.announce = !announce.value;
        touch();
    }
}
</script>

<template>
    <p v-if="dead" class="text-fg-dim">They are no longer in this room.</p>
    <div v-else class="flex h-full flex-col gap-3">
        <p v-if="slots.length === 0" class="px-2 text-fg-dim">No slots are cursed yet.</p>

        <div class="@container min-h-0 flex-1 overflow-y-auto">
            <div class="grid grid-cols-1 content-start gap-x-8 gap-y-0.5 @3xl:grid-cols-2 @6xl:grid-cols-3">
                <div
                    v-for="slot in slots"
                    :key="slot.group"
                    class="flex min-w-0 cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface"
                    @click="openSlot(slot.group)"
                >
                    <span class="min-w-0 flex-1 truncate font-semibold">{{ groupLabel(slot.group) }}</span>
                    <span
                        class="shrink-0 text-sm font-semibold"
                        :style="{ color: slot.active ? '#4caf6d' : 'var(--bcp-text-dim)' }"
                    >{{ slot.active ? "Active" : "Inactive" }}</span>
                    <span class="max-w-56 truncate text-sm text-fg-dim">{{ summary(slot) }}</span>
                </div>
            </div>
        </div>

        <div class="flex flex-wrap items-center gap-4 border-t pt-3" style="border-color: var(--bcp-border);">
            <button
                v-if="canEdit"
                class="rounded-lg px-4 py-2 font-semibold"
                style="background: var(--bcp-accent); color: var(--bcp-on-accent);"
                @click="addCurse()"
            >Curse a slot...</button>
            <label v-if="local" class="flex cursor-pointer items-center gap-2" :class="{ 'opacity-50': !canEdit }">
                <input
                    type="checkbox"
                    class="h-5 w-5"
                    style="accent-color: var(--bcp-accent);"
                    :checked="announce"
                    :disabled="!canEdit"
                    @change="toggleAnnounce()"
                >
                <span>Announce curse activity in chat</span>
            </label>
            <span v-if="!canEdit" class="text-sm text-fg-dim">You do not have permission to change these curses; viewing only.</span>
        </div>
    </div>
</template>
