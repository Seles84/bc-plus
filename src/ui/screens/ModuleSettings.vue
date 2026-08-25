<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from "vue";
import { BCPLUS_KEY } from "@/ui/nav";
import { membersValue, stringListValue } from "@/system/gui/Settings";
import type { AnySetting, StringListSetting } from "@/system/gui/Settings";
import type Authority from "@/modules/Authority";
import type Pet from "@/modules/Pet";

const props = defineProps<{ slug: string }>();
const core = inject(BCPLUS_KEY)!;
const module = core.ModuleManager.getModule(props.slug);

/** Bumped when the save syncs (e.g. a remote SettingCommand landed). */
const version = ref(0);
let unsubscribe: (() => void) | null = null;
onMounted(() => {
    unsubscribe = core.Events.on("saveSynced", () => {
        version.value++;
    });
});
onUnmounted(() => unsubscribe?.());

const settings = computed(() => module?.Settings ?? []);

const canEdit = computed(() => {
    version.value;
    const permission = module?.EditPermission;
    if (!module || !permission) {
        return true;
    }
    const authority = core.ModuleManager.getModule<Authority>("authority");
    return authority?.hasPermission(Player.MemberNumber ?? -1, permission) ?? true;
});

function value(setting: AnySetting): unknown {
    version.value;
    return module?.getSetting(setting.name);
}

function isActive(setting: AnySetting): boolean {
    version.value;
    return canEdit.value && (setting.active?.() ?? true);
}

function set(setting: AnySetting, newValue: unknown): void {
    if (!module || !isActive(setting)) {
        return;
    }
    const previous = module.getSetting(setting.name);
    module.setSetting(setting.name, newValue);
    (setting as { onSet?: (v: unknown, p: unknown) => void }).onSet?.(newValue, previous);
    version.value++;
}

function commitText(setting: AnySetting, event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.value !== String(value(setting) ?? "")) {
        set(setting, input.value);
    }
}

// --- String lists: chip editor ---
const listDrafts = ref<Record<string, string>>({});

function listEntries(setting: StringListSetting): string[] {
    return stringListValue(value(setting), setting.legacySeparator ?? ",");
}

function addListEntry(setting: StringListSetting): void {
    const draft = (listDrafts.value[setting.name] ?? "").trim();
    if (draft.length === 0) {
        return;
    }
    const entries = listEntries(setting);
    if (entries.length >= (setting.maxEntries ?? 50)) {
        return;
    }
    set(setting, [...entries, draft.slice(0, setting.maxChars ?? 200)]);
    listDrafts.value[setting.name] = "";
}

function removeListEntry(setting: StringListSetting, index: number): void {
    const entries = listEntries(setting);
    entries.splice(index, 1);
    set(setting, [...entries]);
}

// --- Module-specific extras ---
const isPetModule = computed(() => props.slug === "pet");
function refillPet(): void {
    if (canEdit.value) {
        core.ModuleManager.getModule<Pet>("pet")?.refill();
        version.value++;
    }
}
</script>

<template>
    <div v-if="module" class="mx-auto flex max-w-3xl flex-col gap-1">
        <div
            v-for="setting in settings"
            :key="setting.name"
            class="flex min-h-12 items-center gap-4 rounded-lg px-3 py-2 hover:bg-surface"
            :class="{ 'opacity-50': !isActive(setting) }"
        >
            <div class="min-w-0 flex-1">
                <span>{{ setting.label }}</span>
                <span
                    v-if="setting.hoverText"
                    class="ml-2 inline-block h-5 w-5 cursor-help rounded-full text-center text-sm leading-5 text-accent"
                    style="border: 1px solid var(--bcp-border);"
                    :title="setting.hoverText"
                >?</span>
            </div>

            <!-- Checkbox -->
            <input
                v-if="setting.type === 'checkbox'"
                type="checkbox"
                class="h-5 w-5 shrink-0"
                style="accent-color: var(--bcp-accent);"
                :checked="value(setting) === true"
                :disabled="!isActive(setting)"
                @change="set(setting, (value(setting) !== true))"
            >

            <!-- Option -->
            <select
                v-else-if="setting.type === 'option'"
                class="max-w-56 shrink-0"
                :disabled="!isActive(setting)"
                :value="String(value(setting) ?? setting.default)"
                @change="set(setting, ($event.target as HTMLSelectElement).value)"
            >
                <option v-for="option in setting.options" :key="option" :value="option">{{ option }}</option>
            </select>

            <!-- Text -->
            <input
                v-else-if="setting.type === 'text'"
                type="text"
                class="w-64 shrink-0"
                :maxlength="setting.maxChars ?? 256"
                :disabled="!isActive(setting)"
                :value="String(value(setting) ?? '')"
                @change="commitText(setting, $event)"
            >

            <!-- String list -->
            <div v-else-if="setting.type === 'stringList'" class="flex max-w-md flex-wrap items-center justify-end gap-1.5">
                <span
                    v-for="(entry, index) in listEntries(setting)"
                    :key="`${entry}-${index}`"
                    class="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-0.5 text-sm"
                    style="border: 1px solid var(--bcp-border);"
                >
                    {{ entry }}
                    <button
                        v-if="isActive(setting)"
                        class="text-fg-dim hover:text-accent"
                        :title="`Remove ${setting.entryLabel ?? 'entry'}`"
                        @click="removeListEntry(setting, index)"
                    >&#10005;</button>
                </span>
                <input
                    v-if="isActive(setting)"
                    v-model="listDrafts[setting.name]"
                    type="text"
                    class="w-36 text-sm"
                    :maxlength="setting.maxChars ?? 200"
                    :placeholder="`Add ${setting.entryLabel ?? 'entry'}...`"
                    @keydown.enter.prevent="addListEntry(setting)"
                    @blur="addListEntry(setting)"
                >
            </div>

            <!-- Members (picker not ported yet) -->
            <span v-else-if="setting.type === 'members'" class="shrink-0 text-sm text-fg-dim">
                {{ membersValue(value(setting)).length }} selected (edit in the classic view)
            </span>
        </div>

        <div v-if="isPetModule" class="mt-3 flex justify-start px-3">
            <button
                class="rounded-lg bg-surface px-4 py-2 hover:bg-surface-hover disabled:opacity-50"
                style="border: 1px solid var(--bcp-border);"
                :disabled="!canEdit"
                title="Top every need back up to 100% (/bcp pet refill works too)"
                @click="refillPet()"
            >Refill all stats</button>
        </div>
        <p v-if="props.slug === 'core'" class="mt-3 px-3 text-sm text-fg-dim">
            Factory reset lives at <code>/bcp reset</code> for now.
        </p>
    </div>
</template>
