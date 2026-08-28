<script setup lang="ts">
import { computed, inject, onMounted } from "vue";
import { PICKER_KEY } from "@/ui/picker";
import { bcpCharacter, useBcpVersion, useNow } from "@/ui/composables";
import SettingRow from "@/ui/components/SettingRow.vue";
import { membersValue } from "@/system/gui/Settings";
import { SendBCPMessage } from "@/utils/Messaging";
import type { AnySetting } from "@/system/gui/Settings";
import type Authority from "@/modules/Authority";
import type DataSync from "@/modules/DataSync";
import type Pet from "@/modules/Pet";

const props = defineProps<{ slug: string; member?: number }>();
const picker = inject(PICKER_KEY)!;
const { version, touch, core } = useBcpVersion();
const now = useNow();
const module = core.ModuleManager.getModule(props.slug);
const character = bcpCharacter(props.member);
const remote = props.member !== undefined;

const settings = computed(() => module?.Settings ?? []);

/**
 * Settings grouped by their declared category (first-appearance order,
 * untagged settings leading). A module without categories renders the
 * classic single list.
 */
const groups = computed(() => {
    const byTitle = new Map<string, AnySetting[]>();
    for (const setting of settings.value) {
        const title = setting.category ?? "";
        const list = byTitle.get(title);
        if (list) {
            list.push(setting);
        } else {
            byTitle.set(title, [setting]);
        }
    }
    const result = [...byTitle.entries()].map(([title, items]) => ({ title, items }));
    result.sort((a, b) => (a.title === "" ? -1 : b.title === "" ? 1 : 0));
    return result;
});
const grouped = computed(() => groups.value.some((g) => g.title !== ""));

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
    void picker.pickMembers({
        title: setting.label,
        initial: membersValue(value(setting)),
    }).then((members) => {
        if (members !== null) {
            set(setting, members);
        }
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
    <div v-if="module" :class="grouped ? '@container mx-auto flex max-w-6xl flex-col gap-1' : 'mx-auto flex max-w-3xl flex-col gap-1'">
        <!-- Categorized modules: section cards flowing into columns as the window grows -->
        <div v-if="grouped" class="gap-5 @3xl:columns-2">
            <section
                v-for="group in groups"
                :key="group.title"
                class="mb-5 break-inside-avoid rounded-lg p-2"
                style="border: 1px solid var(--bcp-border);"
            >
                <h3 v-if="group.title" class="px-3 pb-1 pt-1 font-semibold text-accent">{{ group.title }}</h3>
                <SettingRow
                    v-for="setting in group.items"
                    :key="setting.name"
                    :setting="setting"
                    :value="value(setting)"
                    :disabled="!isActive(setting)"
                    @update="set(setting, $event)"
                    @pick-members="pickMembers(setting)"
                />
            </section>
        </div>
        <template v-else>
            <SettingRow
                v-for="setting in settings"
                :key="setting.name"
                :setting="setting"
                :value="value(setting)"
                :disabled="!isActive(setting)"
                @update="set(setting, $event)"
                @pick-members="pickMembers(setting)"
            />
        </template>

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
                :style="now < resetArmedUntil
                    ? 'background: rgba(224,82,82,0.25); border: 1px solid #e05252; color: #e05252;'
                    : 'background: rgba(224,82,82,0.12); border: 1px solid #e05252; color: #e05252;'"
                :disabled="!canFactoryReset"
                :title="canFactoryReset
                    ? 'Factory reset - wipes every BC+ setting, rule, curse, role and log entry, then reloads'
                    : 'Disabled - your collar is welded'"
                @click="factoryReset()"
            >{{ now < resetArmedUntil ? "Confirm reset" : "Reset BC+" }}</button>
        </div>
        <p v-if="remote && !canEdit" class="mt-3 px-3 text-sm text-fg-dim">
            {{ module.Config.PublicData
                ? "You do not have permission to change these settings; viewing only."
                : "These settings are only shared with people permitted to change them - values shown are defaults." }}
        </p>
    </div>
</template>
