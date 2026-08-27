<script setup lang="ts">
import { computed, ref } from "vue";
import { bcpCharacter, useBcpVersion } from "@/ui/composables";
import type Authority from "@/modules/Authority";
import type Commands from "@/modules/Commands";

const props = defineProps<{ member?: number }>();
const { version, touch, core } = useBcpVersion();

const commands = core.ModuleManager.getModule<Commands>("commands")!;
const local = props.member === undefined;
const character = bcpCharacter(props.member);
const dead = computed(() => {
    version.value;
    return !local && (character === null || bcpCharacter(props.member) === null);
});

const canUse = computed(() => {
    version.value;
    if (local) {
        return commands.canUseOnSelf();
    }
    const authority = core.ModuleManager.getModule<Authority>("authority");
    return character !== null && (authority?.remoteHasPermission(character, "commands.use") ?? false);
});
const definitions = computed(() => {
    version.value;
    return [...commands.Definitions];
});
const whisperOn = computed(() => {
    version.value;
    return commands.getSetting<boolean>("whisperCommands") === true;
});

const argument = ref("");

function invoke(definition: (typeof definitions.value)[number]): void {
    if (canUse.value) {
        commands.invoke(definition, argument.value, character);
    }
}

function toggleWhisper(): void {
    commands.setSetting("whisperCommands", !whisperOn.value);
    touch();
}
</script>

<template>
    <p v-if="dead" class="text-fg-dim">They are no longer in this room.</p>
    <div v-else class="flex h-full flex-col gap-3">
        <label v-if="local" class="flex cursor-pointer items-center gap-2 self-end" title="Turns the whisper interface ('!bcp <command>') on or off">
            <input
                type="checkbox" class="h-5 w-5" style="accent-color: var(--bcp-accent);"
                :checked="whisperOn"
                @change="toggleWhisper()"
            >
            <span>Whisper commands</span>
        </label>
        <p v-if="!canUse" class="px-2 text-fg-dim">You do not have permission to use commands here.</p>

        <div class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
            <div
                v-for="definition in definitions"
                :key="definition.id"
                class="flex items-center gap-4 rounded-lg px-3 py-2 hover:bg-surface"
            >
                <button
                    class="w-44 shrink-0 rounded-lg bg-surface px-3 py-2 font-semibold hover:bg-surface-hover disabled:opacity-50"
                    style="border: 1px solid var(--bcp-border);"
                    :disabled="!canUse"
                    @click="invoke(definition)"
                >{{ definition.name }}</button>
                <span class="min-w-0 flex-1 text-sm text-fg-dim">
                    {{ definition.description }}{{ definition.argument ? " (uses the argument field)" : "" }}
                </span>
            </div>
        </div>

        <div class="flex items-center gap-3 border-t pt-3" style="border-color: var(--bcp-border);">
            <span>Argument:</span>
            <input v-model="argument" type="text" class="flex-1" maxlength="200" :disabled="!canUse">
        </div>
    </div>
</template>
