<script setup lang="ts">
import { computed, inject } from "vue";
import { PICKER_KEY } from "@/ui/picker";
import { useBcpVersion } from "@/ui/composables";
import {
    ConditionData, describeConditions, formatDuration, formatTimeOfDay, parseMembers,
} from "@/system/conditions/Conditions";
import {
    MAX_CONDITION_PRESETS, PRESET_NAME_MAX, applyConditionPreset, deleteConditionPreset,
    getConditionPresets, saveConditionPreset,
} from "@/system/conditions/Presets";
import { Role, RoleNames } from "@/system/Roles";
import { jsonClone } from "@/utils/BCUtils";
import { ref } from "vue";

const props = defineProps<{
    /** Wording for the timer's end effect ("Deactivate" for rules, "Lift curse" for curses). */
    removeLabel: string;
    /** The global conditions set never has a timer. */
    hideTimer?: boolean;
    get: () => ConditionData;
    set: (conditions: ConditionData) => void;
    canEdit: () => boolean;
}>();

const picker = inject(PICKER_KEY)!;
const { version, touch, core } = useBcpVersion();

const conditions = computed(() => {
    version.value;
    return props.get();
});
const editable = computed(() => {
    version.value;
    return props.canEdit();
});
const summary = computed(() => describeConditions(conditions.value));

function update(mutate: (c: ConditionData) => void): void {
    if (!editable.value) {
        return;
    }
    const next = jsonClone(props.get());
    mutate(next);
    props.set(next);
    touch();
}

// --- Timer ---
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const TIMER_STEPS: { label: string; ms: number }[] = [
    { label: "-1d", ms: -DAY }, { label: "-1h", ms: -HOUR }, { label: "-15m", ms: -15 * MINUTE },
    { label: "-5m", ms: -5 * MINUTE }, { label: "-1m", ms: -MINUTE },
    { label: "+1m", ms: MINUTE }, { label: "+5m", ms: 5 * MINUTE }, { label: "+15m", ms: 15 * MINUTE },
    { label: "+1h", ms: HOUR }, { label: "+1d", ms: DAY },
];

function adjustTimer(ms: number): void {
    update((c) => {
        const now = Date.now();
        const base = typeof c.timerEnd === "number" && c.timerEnd > now ? c.timerEnd : now;
        const next = base + ms;
        if (next <= now) {
            delete c.timerEnd;
            delete c.timerAction;
        } else {
            c.timerEnd = next;
            c.timerAction ??= "deactivate";
        }
    });
}

const timerText = computed(() => {
    version.value;
    const end = conditions.value.timerEnd;
    return typeof end === "number" ? `Ends in ${formatDuration(Math.max(0, end - Date.now()))}` : "No timer";
});

// --- Time-of-day window ---
function adjustWindow(edge: "timeStart" | "timeEnd", delta: number): void {
    update((c) => {
        if (c.timeStart === undefined || c.timeEnd === undefined) {
            c.timeStart = 22 * 60;
            c.timeEnd = 7 * 60;
            return;
        }
        c[edge] = ((c[edge] ?? 0) + delta + 1440) % 1440;
    });
}

// --- Roles ---
const roleChoices = RoleNames.map((name, index) => ({ name, role: index as Role }));

// --- Members ---
function pickMembers(): void {
    void picker.pickMembers({
        title: "Members condition",
        initial: parseMembers(conditions.value.members),
    }).then((members) => {
        if (members === null) {
            return;
        }
        update((c) => {
            if (members.length === 0) {
                delete c.members;
                delete c.membersMode;
            } else {
                c.members = members.join(",");
                c.membersMode ??= "present";
            }
        });
    });
}

// --- Presets (stored in Core's private data) ---
const presetName = ref("");
const presetStore = computed(() => core.ModuleManager.getModule("core"));

const presets = computed(() => {
    version.value;
    const store = presetStore.value;
    return store ? getConditionPresets(store) : [];
});

function applyPreset(name: string): void {
    if (!editable.value) {
        return;
    }
    const preset = presets.value.find((p) => p.name === name);
    if (preset) {
        // applyConditionPreset keeps a running timer (presets never store one)
        props.set(applyConditionPreset(jsonClone(props.get()), preset));
        touch();
    }
}

function savePreset(): void {
    const store = presetStore.value;
    const name = presetName.value.trim().slice(0, PRESET_NAME_MAX);
    if (!store || name.length === 0) {
        return;
    }
    saveConditionPreset(store, name, conditions.value);
    presetName.value = "";
    touch();
}

function removePreset(name: string): void {
    const store = presetStore.value;
    if (store) {
        deleteConditionPreset(store, name);
        touch();
    }
}
</script>

<template>
    <div class="mx-auto flex max-w-3xl flex-col gap-4">
        <p class="rounded-lg bg-surface px-3 py-2 text-sm text-fg-dim" style="border: 1px solid var(--bcp-border);">
            {{ summary }}
        </p>

        <!-- Timer -->
        <section v-if="!props.hideTimer" class="flex flex-col gap-2">
            <h3 class="font-semibold text-accent">Timer</h3>
            <div class="flex flex-wrap items-center gap-1.5">
                <button
                    class="rounded-lg bg-surface px-2.5 py-1.5 text-sm hover:bg-surface-hover disabled:opacity-50"
                    style="border: 1px solid var(--bcp-border);"
                    :disabled="!editable"
                    @click="update((c) => { delete c.timerEnd; delete c.timerAction; })"
                >Off</button>
                <button
                    v-for="step in TIMER_STEPS"
                    :key="step.label"
                    class="rounded-lg bg-surface px-2.5 py-1.5 text-sm hover:bg-surface-hover disabled:opacity-50"
                    style="border: 1px solid var(--bcp-border);"
                    :disabled="!editable"
                    @click="adjustTimer(step.ms)"
                >{{ step.label }}</button>
                <span class="ml-2 text-sm text-fg-dim">{{ timerText }}</span>
            </div>
            <div v-if="conditions.timerEnd !== undefined" class="flex items-center gap-2">
                <span>When it ends:</span>
                <select
                    :disabled="!editable"
                    :value="conditions.timerAction ?? 'deactivate'"
                    @change="update((c) => { c.timerAction = ($event.target as HTMLSelectElement).value as 'deactivate' | 'remove'; })"
                >
                    <option value="deactivate">Deactivate</option>
                    <option value="remove">{{ props.removeLabel }}</option>
                </select>
            </div>
        </section>

        <!-- Room -->
        <section class="flex flex-col gap-2">
            <h3 class="font-semibold text-accent">Room</h3>
            <div class="flex items-center gap-2">
                <span class="w-40">Room privacy:</span>
                <select
                    :disabled="!editable"
                    :value="conditions.roomType ?? ''"
                    @change="update((c) => {
                        const v = ($event.target as HTMLSelectElement).value;
                        if (v === '') { delete c.roomType; } else { c.roomType = v as 'public' | 'private'; }
                    })"
                >
                    <option value="">Any room</option>
                    <option value="public">Public rooms</option>
                    <option value="private">Private rooms</option>
                </select>
            </div>
            <div class="flex items-center gap-2">
                <span class="w-40">Room names:</span>
                <input
                    type="text"
                    class="flex-1"
                    maxlength="300"
                    placeholder="Comma-separated name fragments (empty = any)"
                    :disabled="!editable"
                    :value="conditions.roomNames ?? ''"
                    @change="update((c) => {
                        const v = ($event.target as HTMLInputElement).value.trim();
                        if (v === '') { delete c.roomNames; delete c.roomNamesMode; } else { c.roomNames = v; c.roomNamesMode ??= 'in'; }
                    })"
                >
                <select
                    v-if="conditions.roomNames"
                    :disabled="!editable"
                    :value="conditions.roomNamesMode ?? 'in'"
                    @change="update((c) => { c.roomNamesMode = ($event.target as HTMLSelectElement).value as 'in' | 'notin'; })"
                >
                    <option value="in">In one of them</option>
                    <option value="notin">Not in any</option>
                </select>
            </div>
        </section>

        <!-- People -->
        <section class="flex flex-col gap-2">
            <h3 class="font-semibold text-accent">People</h3>
            <div class="flex items-center gap-2">
                <span class="w-40">Role:</span>
                <select
                    :disabled="!editable"
                    :value="conditions.role ?? ''"
                    @change="update((c) => {
                        const v = ($event.target as HTMLSelectElement).value;
                        if (v === '') { delete c.role; delete c.roleMode; } else { c.role = Number(v) as Role; c.roleMode ??= 'present'; }
                    })"
                >
                    <option value="">No role requirement</option>
                    <option v-for="choice in roleChoices" :key="choice.role" :value="choice.role">{{ choice.name }} or higher</option>
                </select>
                <select
                    v-if="conditions.role !== undefined"
                    :disabled="!editable"
                    :value="conditions.roleMode ?? 'present'"
                    @change="update((c) => { c.roleMode = ($event.target as HTMLSelectElement).value as 'present' | 'absent'; })"
                >
                    <option value="present">Must be in the room</option>
                    <option value="absent">Must NOT be in the room</option>
                </select>
            </div>
            <div class="flex items-center gap-2">
                <span class="w-40">Members:</span>
                <button
                    class="rounded-lg bg-surface px-3 py-1.5 hover:bg-surface-hover disabled:opacity-50"
                    style="border: 1px solid var(--bcp-border);"
                    :disabled="!editable"
                    @click="pickMembers()"
                >{{ parseMembers(conditions.members).length }} selected...</button>
                <select
                    v-if="conditions.members"
                    :disabled="!editable"
                    :value="conditions.membersMode ?? 'present'"
                    @change="update((c) => { c.membersMode = ($event.target as HTMLSelectElement).value as 'present' | 'absent'; })"
                >
                    <option value="present">One must be present</option>
                    <option value="absent">All must be absent</option>
                </select>
            </div>
        </section>

        <!-- Time of day -->
        <section class="flex flex-col gap-2">
            <h3 class="font-semibold text-accent">Time of day</h3>
            <div class="flex flex-wrap items-center gap-2">
                <template v-if="conditions.timeStart === undefined || conditions.timeEnd === undefined">
                    <button
                        class="rounded-lg bg-surface px-3 py-1.5 hover:bg-surface-hover disabled:opacity-50"
                        style="border: 1px solid var(--bcp-border);"
                        :disabled="!editable"
                        @click="adjustWindow('timeStart', 0)"
                    >Add a time window (22:00 - 07:00)</button>
                </template>
                <template v-else>
                    <span>From</span>
                    <button class="rounded bg-surface px-2 py-1 text-sm" style="border:1px solid var(--bcp-border);" :disabled="!editable" @click="adjustWindow('timeStart', -30)">-</button>
                    <span class="font-mono">{{ formatTimeOfDay(conditions.timeStart) }}</span>
                    <button class="rounded bg-surface px-2 py-1 text-sm" style="border:1px solid var(--bcp-border);" :disabled="!editable" @click="adjustWindow('timeStart', 30)">+</button>
                    <span>to</span>
                    <button class="rounded bg-surface px-2 py-1 text-sm" style="border:1px solid var(--bcp-border);" :disabled="!editable" @click="adjustWindow('timeEnd', -30)">-</button>
                    <span class="font-mono">{{ formatTimeOfDay(conditions.timeEnd) }}</span>
                    <button class="rounded bg-surface px-2 py-1 text-sm" style="border:1px solid var(--bcp-border);" :disabled="!editable" @click="adjustWindow('timeEnd', 30)">+</button>
                    <button
                        class="ml-2 rounded-lg bg-surface px-3 py-1.5 text-sm hover:bg-surface-hover"
                        style="border: 1px solid var(--bcp-border);"
                        :disabled="!editable"
                        @click="update((c) => { delete c.timeStart; delete c.timeEnd; })"
                    >Remove window</button>
                </template>
                <span class="text-sm text-fg-dim">(this character's local clock, wraps midnight)</span>
            </div>
        </section>

        <!-- Presets -->
        <section class="flex flex-col gap-2">
            <h3 class="font-semibold text-accent">Presets</h3>
            <div class="flex flex-col gap-1">
                <div
                    v-for="preset in presets"
                    :key="preset.name"
                    class="flex items-center gap-2 rounded-lg px-3 py-1.5 hover:bg-surface"
                >
                    <span class="min-w-0 flex-1 truncate">{{ preset.name }}</span>
                    <span class="hidden max-w-xs truncate text-sm text-fg-dim md:inline">{{ describeConditions(preset.conditions) }}</span>
                    <button
                        class="rounded-lg bg-surface px-3 py-1 text-sm hover:bg-surface-hover disabled:opacity-50"
                        style="border: 1px solid var(--bcp-border);"
                        :disabled="!editable"
                        @click="applyPreset(preset.name)"
                    >Apply</button>
                    <button
                        class="rounded px-2 py-1 text-sm text-fg-dim hover:text-accent"
                        title="Delete preset"
                        @click="removePreset(preset.name)"
                    >&#10005;</button>
                </div>
            </div>
            <div v-if="presets.length < MAX_CONDITION_PRESETS" class="flex items-center gap-2">
                <input
                    v-model="presetName"
                    type="text"
                    class="w-56"
                    :maxlength="PRESET_NAME_MAX"
                    placeholder="Save current as..."
                    @keydown.enter.prevent="savePreset()"
                >
                <button
                    class="rounded-lg bg-surface px-3 py-1.5 hover:bg-surface-hover"
                    style="border: 1px solid var(--bcp-border);"
                    @click="savePreset()"
                >Save preset</button>
            </div>
        </section>
    </div>
</template>
