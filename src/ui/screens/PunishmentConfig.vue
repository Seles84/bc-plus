<script setup lang="ts">
import { computed, inject } from "vue";
import { NAV_KEY } from "@/ui/nav";
import { useBcpVersion } from "@/ui/composables";
import { LocalPunishmentAccess, RemotePunishmentAccess } from "@/system/punishments/PunishmentAccess";
import { PUNISHMENT_LOCKS, describeDuration } from "@/system/punishments/PunishmentTypes";
import { bcpCharacter } from "@/ui/composables";
import type Authority from "@/modules/Authority";
import type Curses from "@/modules/Curses";
import type Punishments from "@/modules/Punishments";
import type Rules from "@/modules/Rules";

const props = defineProps<{ id: string; member?: number }>();
const nav = inject(NAV_KEY)!;
const { version, touch, core } = useBcpVersion();

const punishments = core.ModuleManager.getModule<Punishments>("punishments")!;
const character = bcpCharacter(props.member);
// Never fall back to local access for a departed remote target
const dead = props.member !== undefined && character === null;
const access = character
    ? new RemotePunishmentAccess(core.ModuleManager.getModule<Authority>("authority"), character)
    : new LocalPunishmentAccess(punishments);

const definition = computed(() => {
    version.value;
    return access.definitions()[props.id];
});
const canEdit = computed(() => {
    version.value;
    return access.canEdit();
});
const running = computed(() => {
    version.value;
    return access.active()[props.id] !== undefined;
});

const ruleName = computed(() =>
    core.ModuleManager.getModule<Rules>("rules")?.getDefinition(definition.value?.rule ?? "")?.name
        ?? definition.value?.rule ?? "?");

const groupLabel = computed(() =>
    core.ModuleManager.getModule<Curses>("curses")
        ?.curseableGroups().find((g) => g.Name === definition.value?.group)?.Description
        ?? definition.value?.group ?? "?");

function commitName(event: Event): void {
    const value = (event.target as HTMLInputElement).value.trim();
    if (value.length > 0 && value !== definition.value?.name) {
        access.setName(props.id, value);
        touch();
    }
}

function commitDuration(event: Event): void {
    const minutes = Number.parseInt((event.target as HTMLInputElement).value, 10);
    if (Number.isInteger(minutes) && minutes >= 0 && minutes <= 4320) {
        access.setDuration(props.id, minutes);
        touch();
    }
}

function setLock(event: Event): void {
    access.setLock(props.id, (event.target as HTMLSelectElement).value);
    touch();
}

function toggleAnnounce(): void {
    if (canEdit.value && definition.value) {
        access.setAnnounce(props.id, !definition.value.announce);
        touch();
    }
}

function applyNow(): void {
    access.apply(props.id);
    touch();
}

function remove(): void {
    access.remove(props.id);
    touch();
    nav.pop();
}
</script>

<template>
    <p v-if="dead" class="text-fg-dim">They are no longer in this room.</p>
    <div v-else-if="definition" class="mx-auto flex max-w-3xl flex-col gap-4">
        <section class="flex flex-col gap-2">
            <div class="flex items-center gap-3">
                <span class="w-56">Name:</span>
                <input
                    type="text" class="flex-1" maxlength="40"
                    :disabled="!canEdit"
                    :value="definition.name"
                    @change="commitName($event)"
                >
            </div>
            <div class="flex items-center gap-3">
                <span class="w-56">Duration in minutes:</span>
                <input
                    type="text" inputmode="numeric" class="w-24"
                    :disabled="!canEdit"
                    :value="String(definition.durationMin)"
                    @change="commitDuration($event)"
                >
                <span class="text-sm text-fg-dim">{{ describeDuration(definition.durationMin) }} (0 = until lifted)</span>
            </div>

            <template v-if="definition.kind === 'item'">
                <p>Item: <strong>{{ definition.item?.name ?? "?" }}</strong> ({{ groupLabel }})</p>
                <div class="flex items-center gap-3">
                    <span class="w-56">Lock:</span>
                    <select :disabled="!canEdit" :value="definition.lock ?? ''" @change="setLock($event)">
                        <option v-for="lock in PUNISHMENT_LOCKS" :key="lock.asset" :value="lock.asset">{{ lock.label }}</option>
                    </select>
                </div>
            </template>
            <template v-else>
                <p>Forces the rule: <strong>{{ ruleName }}</strong></p>
                <p class="text-sm text-fg-dim">
                    While the punishment runs, the rule is enforced unconditionally and cannot be switched off.
                </p>
            </template>

            <label class="flex cursor-pointer items-center gap-3" :class="{ 'opacity-50': !canEdit }">
                <input
                    type="checkbox" class="h-5 w-5" style="accent-color: var(--bcp-accent);"
                    :checked="definition.announce" :disabled="!canEdit"
                    @change="toggleAnnounce()"
                >
                <span>Announce this punishment in chat</span>
            </label>

            <p v-if="definition.addedBy" class="text-sm text-fg-dim">
                Created by {{ definition.addedBy.name }} (#{{ definition.addedBy.member }})
            </p>
            <p v-if="running" class="rounded-lg px-3 py-2 text-sm" style="background: rgba(224,82,82,0.12); color: #e05252;">
                This punishment is running right now.
            </p>
        </section>

        <section v-if="canEdit" class="flex flex-wrap gap-2">
            <button
                class="rounded-lg bg-surface px-4 py-2 hover:bg-surface-hover disabled:opacity-50"
                style="border: 1px solid var(--bcp-border);"
                :disabled="running"
                title="Punish immediately, without a rule violation"
                @click="applyNow()"
            >Apply now</button>
            <span class="flex-1"></span>
            <button
                class="rounded-lg px-4 py-2"
                style="background: rgba(224,82,82,0.15); border: 1px solid #e05252; color: #e05252;"
                title="Removes the definition; a running punishment continues until it ends"
                @click="remove()"
            >Delete punishment</button>
        </section>
    </div>
    <p v-else class="text-fg-dim">Waiting for punishment data...</p>
</template>
