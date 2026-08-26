<script setup lang="ts">
import { computed } from "vue";
import { bcpCharacter, useBcpVersion } from "@/ui/composables";
import { RoleNames } from "@/system/Roles";
import { SendBCPMessage } from "@/utils/Messaging";
import type Authority from "@/modules/Authority";

const props = defineProps<{ member?: number }>();
const { version, touch, core } = useBcpVersion();

const authority = core.ModuleManager.getModule<Authority>("authority")!;
const character = bcpCharacter(props.member);
const remote = props.member !== undefined;

const canEdit = computed(() => {
    version.value;
    const permission = authority.EditPermission;
    if (remote) {
        return permission !== null && character !== null
            && (authority.remoteHasPermission(character, permission) ?? false);
    }
    return !permission || (authority.hasPermission(Player.MemberNumber ?? -1, permission) ?? true);
});

const defs = computed(() => {
    version.value;
    return authority.PermissionDefs;
});

/** Permissions grouped by their owning module, in registration order. */
const groups = computed(() => {
    const byModule = new Map<string, typeof defs.value>();
    for (const def of defs.value) {
        const title = def.module ?? "Other";
        const list = byModule.get(title);
        if (list) {
            list.push(def);
        } else {
            byModule.set(title, [def]);
        }
    }
    return [...byModule.entries()].map(([title, items]) => ({ title, items }));
});

function get(name: string): unknown {
    version.value;
    if (remote) {
        return character?.BCPData?.["authority"]?.[name]
            ?? authority.Settings.find((s) => s.name === name)?.default;
    }
    return authority.getSetting(name);
}

function set(name: string, value: unknown): void {
    if (!canEdit.value) {
        return;
    }
    if (remote) {
        // No optimistic write; the target's change-broadcast updates the mirror
        SendBCPMessage({ message: "SettingCommand", module: "authority", name, value }, props.member!);
        return;
    }
    authority.setSetting(name, value);
    touch();
}

function roleOf(id: string): string {
    return String(get(`${id}.role`) ?? "Public");
}

function selfOf(id: string): boolean {
    return get(`${id}.self`) === true;
}

function setRole(id: string, event: Event): void {
    set(`${id}.role`, (event.target as HTMLSelectElement).value);
}

function toggleSelf(id: string): void {
    set(`${id}.self`, !selfOf(id));
}
</script>

<template>
    <div class="@container mx-auto flex max-w-6xl flex-col gap-1">
        <div class="gap-5 @3xl:columns-2">
            <section
                v-for="group in groups"
                :key="group.title"
                class="mb-5 break-inside-avoid rounded-lg p-2"
                style="border: 1px solid var(--bcp-border);"
            >
                <div class="flex items-center gap-4 px-3 pb-1 pt-1">
                    <h3 class="min-w-0 flex-1 font-semibold text-accent">{{ group.title }}</h3>
                    <span class="w-40 text-sm text-fg-dim">Lowest role allowed</span>
                    <span class="w-12 text-center text-sm text-fg-dim">Self</span>
                </div>
                <div
                    v-for="def in group.items"
                    :key="def.id"
                    class="flex items-center gap-4 rounded-lg px-3 py-2 hover:bg-surface"
                    :class="{ 'opacity-60': !canEdit }"
                >
                    <span class="min-w-0 flex-1 truncate" :title="def.label">{{ def.label }}</span>
                    <select class="w-40" :disabled="!canEdit" :value="roleOf(def.id)" @change="setRole(def.id, $event)">
                        <option v-for="name in RoleNames" :key="name" :value="name">{{ name }}</option>
                    </select>
                    <span class="flex w-12 justify-center">
                        <input
                            type="checkbox" class="h-5 w-5" style="accent-color: var(--bcp-accent);"
                            :checked="selfOf(def.id)" :disabled="!canEdit"
                            @change="toggleSelf(def.id)"
                        >
                    </span>
                </div>
            </section>
        </div>
        <p v-if="!canEdit" class="px-3 text-sm text-fg-dim">
            You do not have permission to change these settings; viewing only.
        </p>
    </div>
</template>
