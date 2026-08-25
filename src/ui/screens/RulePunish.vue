<script setup lang="ts">
import { computed } from "vue";
import { useBcpVersion } from "@/ui/composables";
import {
    PUNISHMENT_LOCKS, PunishmentDefinition, RulePunishConfig, describeDuration,
} from "@/system/punishments/PunishmentTypes";
import type Curses from "@/modules/Curses";
import type Rules from "@/modules/Rules";

const props = defineProps<{
    get: () => RulePunishConfig;
    set: (config: RulePunishConfig) => void;
    canEdit: () => boolean;
    definitions: () => Record<string, PunishmentDefinition>;
}>();

const { version, touch, core } = useBcpVersion();

const config = computed(() => {
    version.value;
    return props.get();
});
const editable = computed(() => {
    version.value;
    return props.canEdit();
});
const available = computed(() => {
    version.value;
    return Object.values(props.definitions());
});

const THRESHOLDS = [1, 2, 3, 5, 10, 15, 20];
const WINDOWS = [1, 2, 5, 10, 15, 30, 60];
const REPEATS: readonly { value: RulePunishConfig["repeat"]; label: string }[] = [
    { value: "stack", label: "Add time" },
    { value: "restart", label: "Restart timer" },
    { value: "ignore", label: "Ignore" },
];

function update(change: Partial<RulePunishConfig>): void {
    if (editable.value) {
        props.set({ ...props.get(), ...change });
        touch();
    }
}

function toggle(definitionId: string): void {
    const current = config.value.punishments;
    update({
        punishments: current.includes(definitionId)
            ? current.filter((p) => p !== definitionId)
            : [...current, definitionId],
    });
}

function describeDefinition(definition: PunishmentDefinition): string {
    const duration = describeDuration(definition.durationMin);
    if (definition.kind === "rule") {
        const rule = core.ModuleManager.getModule<Rules>("rules")?.getDefinition(definition.rule ?? "");
        return `Forces "${rule?.name ?? definition.rule ?? "?"}" - ${duration}`;
    }
    const group = core.ModuleManager.getModule<Curses>("curses")
        ?.curseableGroups().find((g) => g.Name === definition.group)?.Description ?? definition.group ?? "?";
    const lock = PUNISHMENT_LOCKS.find((l) => l.asset === (definition.lock ?? ""));
    return `${group} - ${duration}${lock && lock.asset !== "" ? `, ${lock.label.toLocaleLowerCase()}` : ""}`;
}
</script>

<template>
    <div class="mx-auto flex max-w-3xl flex-col gap-4">
        <section class="flex flex-col gap-1">
            <h3 class="px-3 font-semibold text-accent">Punishments applied when this rule is broken</h3>
            <p v-if="available.length === 0" class="px-3 text-fg-dim">
                No punishments defined yet - create them on the Punishments page.
            </p>
            <label
                v-for="definition in available"
                :key="definition.id"
                class="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface"
                :class="{ 'opacity-50': !editable }"
            >
                <input
                    type="checkbox" class="h-5 w-5" style="accent-color: var(--bcp-accent);"
                    :checked="config.punishments.includes(definition.id)"
                    :disabled="!editable"
                    @change="toggle(definition.id)"
                >
                <span class="min-w-0 flex-1 truncate">{{ definition.name }}</span>
                <span class="max-w-sm truncate text-sm text-fg-dim">{{ describeDefinition(definition) }}</span>
            </label>
        </section>

        <section class="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg bg-surface p-3" style="border: 1px solid var(--bcp-border);">
            <label class="flex items-center gap-2">
                <span>Punish after</span>
                <select
                    :disabled="!editable"
                    :value="String(config.threshold)"
                    title="How many violations within the window trigger the punishment"
                    @change="update({ threshold: Number(($event.target as HTMLSelectElement).value) })"
                >
                    <option v-for="n in THRESHOLDS" :key="n" :value="String(n)">{{ n }} violation{{ n === 1 ? "" : "s" }}</option>
                </select>
            </label>
            <label class="flex items-center gap-2">
                <span>within</span>
                <select
                    :disabled="!editable"
                    :value="String(config.windowMin)"
                    title="The rolling time window violations are counted in"
                    @change="update({ windowMin: Number(($event.target as HTMLSelectElement).value) })"
                >
                    <option v-for="n in WINDOWS" :key="n" :value="String(n)">{{ n }} min</option>
                </select>
            </label>
            <label class="flex items-center gap-2">
                <span>While running:</span>
                <select
                    :disabled="!editable"
                    :value="config.repeat"
                    title="What further violations do while the punishment is already running"
                    @change="update({ repeat: ($event.target as HTMLSelectElement).value as RulePunishConfig['repeat'] })"
                >
                    <option v-for="repeat in REPEATS" :key="repeat.value" :value="repeat.value">{{ repeat.label }}</option>
                </select>
            </label>
        </section>
    </div>
</template>
