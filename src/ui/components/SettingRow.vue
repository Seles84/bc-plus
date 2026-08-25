<script setup lang="ts">
import { computed, ref } from "vue";
import { stringListValue, membersValue } from "@/system/gui/Settings";
import type { AnySetting, StringListSetting } from "@/system/gui/Settings";

const props = defineProps<{
    setting: AnySetting;
    value: unknown;
    disabled: boolean;
}>();

const emit = defineEmits<{
    update: [value: unknown];
    /** Members settings ask the parent to open the picker. */
    pickMembers: [];
}>();

const listDraft = ref("");

const listEntries = computed(() => {
    const setting = props.setting as StringListSetting;
    return props.setting.type === "stringList" ? stringListValue(props.value, setting.legacySeparator ?? ",") : [];
});

function addListEntry(): void {
    const setting = props.setting as StringListSetting;
    const draft = listDraft.value.trim();
    if (draft.length === 0 || listEntries.value.length >= (setting.maxEntries ?? 50)) {
        return;
    }
    emit("update", [...listEntries.value, draft.slice(0, setting.maxChars ?? 200)]);
    listDraft.value = "";
}

function removeListEntry(index: number): void {
    const entries = [...listEntries.value];
    entries.splice(index, 1);
    emit("update", entries);
}

function commitText(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.value !== String(props.value ?? "")) {
        emit("update", input.value);
    }
}

const memberCount = computed(() =>
    (props.setting.type === "members" ? membersValue(props.value).length : 0));
</script>

<template>
    <div
        class="flex min-h-12 items-center gap-4 rounded-lg px-3 py-2 hover:bg-surface"
        :class="{ 'opacity-50': disabled }"
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
            :checked="value === true"
            :disabled="disabled"
            @change="emit('update', value !== true)"
        >

        <!-- Option with icons: one image button per choice -->
        <div v-else-if="setting.type === 'option' && setting.icons" class="flex shrink-0 gap-1.5">
            <button
                v-for="(option, index) in setting.options"
                :key="option"
                class="flex h-12 w-12 items-center justify-center rounded-lg bg-surface hover:bg-surface-hover disabled:cursor-default"
                :style="{ border: option === String(value) ? '3px solid var(--bcp-accent)' : '1px solid var(--bcp-border)' }"
                :title="option"
                :disabled="disabled"
                @click="emit('update', option)"
            >
                <img v-if="setting.icons[index]" :src="setting.icons[index]!" class="h-9 w-9" alt="">
                <span v-else class="text-xs">{{ option }}</span>
            </button>
        </div>

        <!-- Option -->
        <select
            v-else-if="setting.type === 'option'"
            class="max-w-56 shrink-0"
            :disabled="disabled"
            :value="String(value ?? setting.default)"
            @change="emit('update', ($event.target as HTMLSelectElement).value)"
        >
            <option v-for="option in setting.options" :key="option" :value="option">{{ option }}</option>
        </select>

        <!-- Text -->
        <input
            v-else-if="setting.type === 'text'"
            type="text"
            class="w-64 shrink-0"
            :maxlength="setting.maxChars ?? 256"
            :disabled="disabled"
            :value="String(value ?? '')"
            @change="commitText($event)"
        >

        <!-- String list -->
        <div v-else-if="setting.type === 'stringList'" class="flex max-w-md flex-wrap items-center justify-end gap-1.5">
            <span
                v-for="(entry, index) in listEntries"
                :key="`${entry}-${index}`"
                class="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-0.5 text-sm"
                style="border: 1px solid var(--bcp-border);"
            >
                {{ entry }}
                <button
                    v-if="!disabled"
                    class="text-fg-dim hover:text-accent"
                    :title="`Remove ${setting.entryLabel ?? 'entry'}`"
                    @click="removeListEntry(index)"
                >&#10005;</button>
            </span>
            <input
                v-if="!disabled"
                v-model="listDraft"
                type="text"
                class="w-36 text-sm"
                :maxlength="(setting as StringListSetting).maxChars ?? 200"
                :placeholder="`Add ${setting.entryLabel ?? 'entry'}...`"
                @keydown.enter.prevent="addListEntry()"
                @blur="addListEntry()"
            >
        </div>

        <!-- Members -->
        <button
            v-else-if="setting.type === 'members'"
            class="shrink-0 rounded-lg bg-surface px-3 py-1.5 hover:bg-surface-hover disabled:cursor-default"
            style="border: 1px solid var(--bcp-border);"
            :disabled="disabled"
            @click="emit('pickMembers')"
        >{{ memberCount }} selected...</button>
    </div>
</template>
