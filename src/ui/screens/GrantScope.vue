<script setup lang="ts">
import { computed } from "vue";
import { useBcpVersion } from "@/ui/composables";
import type Authority from "@/modules/Authority";
import type Roles from "@/modules/Roles";

const props = defineProps<{
    roleId: string;
    permissionId: string;
    items: { id: string; label: string }[];
}>();

const { version, touch, core } = useBcpVersion();

const roles = core.ModuleManager.getModule<Roles>("roles")!;
const authority = core.ModuleManager.getModule<Authority>("authority");

const role = computed(() => {
    version.value;
    return roles.getCustomRole(props.roleId);
});
const canEdit = computed(() => {
    version.value;
    return authority?.hasPermission(Player.MemberNumber ?? -1, "authority.edit") ?? false;
});
const full = computed(() => role.value?.grants.includes(props.permissionId) ?? false);

function toggleFull(): void {
    if (canEdit.value) {
        roles.setCustomRoleGrant(props.roleId, props.permissionId, !full.value);
        touch();
    }
}

function scoped(itemId: string): boolean {
    return role.value?.grants.includes(`${props.permissionId}:${itemId}`) ?? false;
}

function toggleScoped(itemId: string): void {
    if (canEdit.value && !full.value) {
        roles.setCustomRoleGrant(props.roleId, `${props.permissionId}:${itemId}`, !scoped(itemId));
        touch();
    }
}
</script>

<template>
    <div v-if="role" class="mx-auto flex max-w-3xl flex-col gap-2">
        <p class="px-3 text-sm text-fg-dim">
            Choose what this role's grant covers: everything, or only the ticked items. Members can
            then use the permission exactly on those items and nothing else.
        </p>
        <label
            class="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 font-semibold hover:bg-surface"
            :class="{ 'opacity-60': !canEdit }"
        >
            <input
                type="checkbox" class="h-5 w-5" style="accent-color: var(--bcp-accent);"
                :checked="full" :disabled="!canEdit"
                @change="toggleFull()"
            >
            <span>Grant for everything</span>
        </label>
        <div class="border-t" style="border-color: var(--bcp-border);"></div>
        <div class="flex flex-col gap-0.5">
            <label
                v-for="item in props.items"
                :key="item.id"
                class="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5 hover:bg-surface"
                :class="{ 'opacity-60': full || !canEdit }"
            >
                <input
                    type="checkbox" class="h-5 w-5" style="accent-color: var(--bcp-accent);"
                    :checked="full || scoped(item.id)" :disabled="full || !canEdit"
                    @change="toggleScoped(item.id)"
                >
                <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
            </label>
        </div>
    </div>
    <p v-else class="text-fg-dim">This role no longer exists.</p>
</template>
