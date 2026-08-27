<script setup lang="ts">
import { computed, inject } from "vue";
import { NAV_KEY } from "@/ui/nav";
import { useBcpVersion } from "@/ui/composables";
import AssetPicker from "@/ui/screens/AssetPicker.vue";
import Conditions from "@/ui/screens/Conditions.vue";
import { LocalCurseAccess, RemoteCurseAccess } from "@/system/curses/CurseAccess";
import { CURSE_LOCKS, lockApplicableFor } from "@/system/curses/CurseTypes";
import { describeConditions } from "@/system/conditions/Conditions";
import { bcpCharacter } from "@/ui/composables";
import type Authority from "@/modules/Authority";
import type Curses from "@/modules/Curses";

const props = defineProps<{ group: string; member?: number }>();
const nav = inject(NAV_KEY)!;
const { version, touch, core } = useBcpVersion();

const curses = core.ModuleManager.getModule<Curses>("curses")!;
const character = bcpCharacter(props.member);
// A departed remote target must NEVER fall back to local access - group
// names are universal, so the editor would open the viewer's own curse.
const dead = computed(() => {
    version.value;
    return props.member !== undefined && (character === null || bcpCharacter(props.member) === null);
});
const access = character
    ? new RemoteCurseAccess(curses, core.ModuleManager.getModule<Authority>("authority"), character)
    : new LocalCurseAccess(curses);

const slot = computed(() => {
    version.value;
    return access.slot(props.group);
});
const canEdit = computed(() => {
    version.value;
    return access.canEdit();
});

const groupLabel = computed(() =>
    curses.curseableGroups().find((g) => g.Name === props.group)?.Description ?? props.group);

/** Owner/Lover locks only offer when applicable - a stored one stays clearable. */
const lockOptions = computed(() => {
    version.value;
    return CURSE_LOCKS.filter((l) =>
        l.asset === "" || l.asset === slot.value?.lock || lockApplicableFor(access.subject(), l.asset));
});

function set(action: () => void): void {
    if (canEdit.value) {
        action();
        touch();
    }
}

function openConditions(): void {
    nav.push({
        component: Conditions,
        title: `Conditions - ${groupLabel.value}`,
        props: {
            removeLabel: "Lift curse",
            get: () => access.slot(props.group)?.conditions ?? {},
            set: (c: unknown) => access.setConditions(props.group, c as never),
            canEdit: () => access.canEdit(),
        },
    });
}

function addFromCatalog(): void {
    nav.push({
        component: AssetPicker,
        title: `Add item - ${groupLabel.value}`,
        props: {
            group: props.group as AssetGroupName,
            note: "Click an item to allow it under this curse. Catalog picks are loose: any color "
                + "or configuration of the item passes. For an exact captured state (color, type, "
                + "crafting), wear and configure the item, then use 'Allow currently worn item' "
                + "instead and keep it strict.",
            pick: (asset: string) => {
                access.addCatalogItem(props.group, asset);
                touch();
            },
        },
    });
}

function removeCurse(): void {
    access.removeCurse(props.group);
    touch();
    nav.pop();
}
</script>

<template>
    <p v-if="dead" class="text-fg-dim">They are no longer in this room.</p>
    <div v-else-if="slot" class="mx-auto flex max-w-3xl flex-col gap-4">
        <section class="flex flex-col gap-1">
            <label class="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface" :class="{ 'opacity-50': !canEdit }">
                <input
                    type="checkbox" class="h-5 w-5" style="accent-color: var(--bcp-accent);"
                    :checked="slot.active" :disabled="!canEdit"
                    @change="set(() => access.setActive(props.group, !slot!.active))"
                >
                <span>Curse is active</span>
            </label>
            <label class="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface" :class="{ 'opacity-50': !canEdit }">
                <input
                    type="checkbox" class="h-5 w-5" style="accent-color: var(--bcp-accent);"
                    :checked="slot.allowEmpty" :disabled="!canEdit"
                    @change="set(() => access.setAllowEmpty(props.group, !slot!.allowEmpty))"
                >
                <span>Slot may also be empty</span>
            </label>
            <div class="flex items-center gap-3 rounded-lg px-3 py-2">
                <span>Lock:</span>
                <select
                    :disabled="!canEdit"
                    :value="slot.lock ?? ''"
                    @change="set(() => access.setLock(props.group, ($event.target as HTMLSelectElement).value))"
                >
                    <option v-for="lock in lockOptions" :key="lock.asset" :value="lock.asset">{{ lock.label }}</option>
                </select>
            </div>
            <p v-if="slot.addedBy" class="px-3 text-sm text-fg-dim">
                Cursed by {{ slot.addedBy.name }} (#{{ slot.addedBy.member }})
            </p>
        </section>

        <section class="flex items-center gap-3 rounded-lg bg-surface p-3" style="border: 1px solid var(--bcp-border);">
            <button
                class="rounded-lg bg-bg px-3 py-1.5 hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                title="When this curse is in effect"
                @click="openConditions()"
            >Conditions...</button>
            <span class="min-w-0 flex-1 truncate text-sm text-fg-dim">{{ describeConditions(slot.conditions) }}</span>
        </section>

        <section class="flex flex-col gap-1">
            <h3 class="px-3 font-semibold text-accent">Allowed items (each with its own rules)</h3>
            <p v-if="slot.items.length === 0" class="px-3 text-fg-dim">None - the slot is cursed empty.</p>
            <div
                v-for="(spec, index) in slot.items"
                :key="`${spec.asset}-${index}`"
                class="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface"
            >
                <span class="min-w-0 flex-1 truncate">{{ spec.name }}</span>
                <label class="flex cursor-pointer items-center gap-2 text-sm" :class="{ 'opacity-50': !canEdit }">
                    <input
                        type="checkbox" class="h-4 w-4" style="accent-color: var(--bcp-accent);"
                        :checked="spec.strict" :disabled="!canEdit"
                        @change="set(() => access.setStrict(props.group, index, !spec.strict))"
                    >
                    <span title="Strict restores the captured color/properties/craft exactly; loose only requires the same asset">Strict</span>
                </label>
                <button
                    v-if="canEdit"
                    class="rounded px-2 py-1 text-fg-dim hover:text-accent"
                    title="Remove from allowed items"
                    @click="set(() => access.removeItem(props.group, index))"
                >&#10005;</button>
            </div>
        </section>

        <section v-if="canEdit" class="flex flex-wrap gap-2">
            <button
                class="rounded-lg bg-surface px-4 py-2 hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                title="Adds what is worn in this slot to the allowed list"
                @click="set(() => access.addCurrentItem(props.group))"
            >Allow currently worn item</button>
            <button
                class="rounded-lg bg-surface px-4 py-2 hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                title="Browse every item for this slot - nothing has to be worn"
                @click="addFromCatalog()"
            >Add from catalog...</button>
            <span class="flex-1"></span>
            <button
                class="rounded-lg px-4 py-2"
                style="background: rgba(224,82,82,0.15); border: 1px solid #e05252; color: #e05252;"
                title="Lifts the curse from this slot entirely"
                @click="removeCurse()"
            >Remove this curse</button>
        </section>
    </div>
    <p v-else class="text-fg-dim">Waiting for curse data...</p>
</template>
