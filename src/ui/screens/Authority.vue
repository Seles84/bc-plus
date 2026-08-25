<script setup lang="ts">
import { computed } from "vue";
import { useBcpVersion } from "@/ui/composables";
import { RoleNames } from "@/system/Roles";
import type Authority from "@/modules/Authority";

const { version, touch, core } = useBcpVersion();

const authority = core.ModuleManager.getModule<Authority>("authority")!;

const canEdit = computed(() => {
    version.value;
    const permission = authority.EditPermission;
    return !permission || (authority.hasPermission(Player.MemberNumber ?? -1, permission) ?? true);
});

const defs = computed(() => {
    version.value;
    return authority.PermissionDefs;
});

function roleOf(id: string): string {
    version.value;
    return authority.getSetting<string>(`${id}.role`);
}

function selfOf(id: string): boolean {
    version.value;
    return authority.getSetting<boolean>(`${id}.self`);
}

function setRole(id: string, event: Event): void {
    if (canEdit.value) {
        authority.setSetting(`${id}.role`, (event.target as HTMLSelectElement).value);
        touch();
    }
}

function toggleSelf(id: string): void {
    if (canEdit.value) {
        authority.setSetting(`${id}.self`, !selfOf(id));
        touch();
    }
}
</script>

<template>
    <div class="mx-auto flex max-w-4xl flex-col gap-0.5">
        <div class="flex items-center gap-4 px-3 pb-1 text-sm text-fg-dim">
            <span class="min-w-0 flex-1">Permission</span>
            <span class="w-48">Lowest role allowed</span>
            <span class="w-12 text-center">Self</span>
        </div>
        <div
            v-for="def in defs"
            :key="def.id"
            class="flex items-center gap-4 rounded-lg px-3 py-2 hover:bg-surface"
            :class="{ 'opacity-60': !canEdit }"
        >
            <span class="min-w-0 flex-1 truncate">{{ def.label }}</span>
            <select class="w-48" :disabled="!canEdit" :value="roleOf(def.id)" @change="setRole(def.id, $event)">
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
        <p v-if="!canEdit" class="px-3 pt-2 text-sm text-fg-dim">
            You do not have permission to change these settings; viewing only.
        </p>
    </div>
</template>
