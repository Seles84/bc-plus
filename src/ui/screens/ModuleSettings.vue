<script setup lang="ts">
import { computed, inject, onMounted } from "vue";
import { NAV_KEY } from "@/ui/nav";
import { bcpCharacter, useBcpVersion } from "@/ui/composables";
import SettingRow from "@/ui/components/SettingRow.vue";
import MembersPicker from "@/ui/screens/MembersPicker.vue";
import { membersValue } from "@/system/gui/Settings";
import { SendBCPMessage } from "@/utils/Messaging";
import type { AnySetting } from "@/system/gui/Settings";
import type Authority from "@/modules/Authority";
import type DataSync from "@/modules/DataSync";
import type Pet from "@/modules/Pet";

const props = defineProps<{ slug: string; member?: number }>();
const nav = inject(NAV_KEY)!;
const { version, touch, core } = useBcpVersion();
const module = core.ModuleManager.getModule(props.slug);
const character = bcpCharacter(props.member);
const remote = props.member !== undefined;

const settings = computed(() => module?.Settings ?? []);

onMounted(() => {
    // Private modules' settings are not in the public mirror - ask the
    // target for a fresh view (the response bumps the version)
    if (character && module && !module.Config.PublicData) {
        core.ModuleManager.getModule<DataSync>("data-sync")
            ?.requestModuleSettings(module.Slug, character.MemberNumber);
    }
});

const canEdit = computed(() => {
    version.value;
    const permission = module?.EditPermission;
    const authority = core.ModuleManager.getModule<Authority>("authority");
    if (remote) {
        if (!module || !permission || !character) {
            return false;
        }
        return authority?.remoteHasPermission(character, permission) ?? false;
    }
    if (!module || !permission) {
        return true;
    }
    return authority?.hasPermission(Player.MemberNumber ?? -1, permission) ?? true;
});

function value(setting: AnySetting): unknown {
    version.value;
    if (remote) {
        return character?.BCPData?.[props.slug]?.[setting.name] ?? setting.default;
    }
    return module?.getSetting(setting.name);
}

function isActive(setting: AnySetting): boolean {
    version.value;
    // active() reads OUR data and is meaningless on a remote view
    return canEdit.value && (remote || (setting.active?.() ?? true));
}

function set(setting: AnySetting, newValue: unknown): void {
    if (!module || !isActive(setting)) {
        return;
    }
    if (remote) {
        // No optimistic write; the target's fresh view/broadcast updates us
        SendBCPMessage({
            message: "SettingCommand",
            module: props.slug,
            name: setting.name,
            value: newValue,
        }, props.member!);
        return;
    }
    const previous = module.getSetting(setting.name);
    module.setSetting(setting.name, newValue);
    (setting as { onSet?: (v: unknown, p: unknown) => void }).onSet?.(newValue, previous);
    touch();
}

function pickMembers(setting: AnySetting): void {
    nav.push({
        component: MembersPicker,
        title: setting.label,
        props: {
            initial: membersValue(value(setting)),
            onDone: (members: number[]) => set(setting, members),
        },
    });
}

const isPetModule = computed(() => props.slug === "pet" && !remote);
function refillPet(): void {
    if (canEdit.value) {
        core.ModuleManager.getModule<Pet>("pet")?.refill();
        touch();
    }
}

// --- General page: the factory reset (two-click armed) ---
import { ref } from "vue";
import type Core from "@/modules/Core";
const resetArmedUntil = ref(0);
const canFactoryReset = computed(() => {
    version.value;
    return (core.ModuleManager.getModule("core") as Core | undefined)?.canFactoryReset() ?? false;
});
function factoryReset(): void {
    const coreModule = core.ModuleManager.getModule("core") as Core | undefined;
    if (!coreModule || !canFactoryReset.value) {
        return;
    }
    if (Date.now() < resetArmedUntil.value) {
        resetArmedUntil.value = 0;
        void coreModule.factoryReset();
    } else {
        resetArmedUntil.value = Date.now() + 4_000;
        touch();
    }
}
</script>

<template>
    <div v-if="module" class="mx-auto flex max-w-3xl flex-col gap-1">
        <SettingRow
            v-for="setting in settings"
            :key="setting.name"
            :setting="setting"
            :value="value(setting)"
            :disabled="!isActive(setting)"
            @update="set(setting, $event)"
            @pick-members="pickMembers(setting)"
        />

        <div v-if="isPetModule" class="mt-3 flex justify-start px-3">
            <button
                class="rounded-lg bg-surface px-4 py-2 hover:bg-surface-hover disabled:opacity-50"
                style="border: 1px solid var(--bcp-border);"
                :disabled="!canEdit"
                title="Top every need back up to 100% (/bcp pet refill works too)"
                @click="refillPet()"
            >Refill all stats</button>
        </div>
        <div v-if="props.slug === 'core' && !remote" class="mt-3 flex items-center gap-3 px-3">
            <button
                class="rounded-lg px-4 py-2 disabled:opacity-50"
                :style="Date.now() < resetArmedUntil
                    ? 'background: rgba(224,82,82,0.25); border: 1px solid #e05252; color: #e05252;'
                    : 'background: rgba(224,82,82,0.12); border: 1px solid #e05252; color: #e05252;'"
                :disabled="!canFactoryReset"
                :title="canFactoryReset
                    ? 'Factory reset - wipes every BC+ setting, rule, curse, role and log entry, then reloads'
                    : 'Disabled - your collar is welded'"
                @click="factoryReset()"
            >{{ Date.now() < resetArmedUntil ? "Confirm reset" : "Reset BC+" }}</button>
        </div>
        <p v-if="remote && !canEdit" class="mt-3 px-3 text-sm text-fg-dim">
            {{ module.Config.PublicData
                ? "You do not have permission to change these settings; viewing only."
                : "These settings are only shared with people permitted to change them - values shown are defaults." }}
        </p>
    </div>
</template>
