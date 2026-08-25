<script setup lang="ts">
import { computed, inject } from "vue";
import { NAV_KEY } from "@/ui/nav";
import { useBcpVersion } from "@/ui/composables";
import SettingRow from "@/ui/components/SettingRow.vue";
import MembersPicker from "@/ui/screens/MembersPicker.vue";
import { membersValue } from "@/system/gui/Settings";
import type { AnySetting } from "@/system/gui/Settings";
import type Authority from "@/modules/Authority";
import type Pet from "@/modules/Pet";

const props = defineProps<{ slug: string }>();
const nav = inject(NAV_KEY)!;
const { version, touch, core } = useBcpVersion();
const module = core.ModuleManager.getModule(props.slug);

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

const isPetModule = computed(() => props.slug === "pet");
function refillPet(): void {
    if (canEdit.value) {
        core.ModuleManager.getModule<Pet>("pet")?.refill();
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
        <p v-if="props.slug === 'core'" class="mt-3 px-3 text-sm text-fg-dim">
            Factory reset lives at <code>/bcp reset</code> for now.
        </p>
    </div>
</template>
