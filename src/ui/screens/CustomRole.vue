<script setup lang="ts">
import { computed, inject } from "vue";
import { NAV_KEY } from "@/ui/nav";
import { useBcpVersion } from "@/ui/composables";
import GrantScope from "@/ui/screens/GrantScope.vue";
import type Authority from "@/modules/Authority";
import type Commands from "@/modules/Commands";
import type Curses from "@/modules/Curses";
import type Roles from "@/modules/Roles";
import type Rules from "@/modules/Rules";

const props = defineProps<{ roleId: string }>();
const nav = inject(NAV_KEY)!;
const { version, touch, core } = useBcpVersion();

const roles = core.ModuleManager.getModule<Roles>("roles")!;
const authority = core.ModuleManager.getModule<Authority>("authority");

const role = computed(() => {
    version.value;
    return roles.getCustomRole(props.roleId);
});
const canEditGrants = computed(() => {
    version.value;
    return authority?.hasPermission(Player.MemberNumber ?? -1, "authority.edit") ?? false;
});
const canDelete = computed(() => {
    version.value;
    return authority?.hasPermission(Player.MemberNumber ?? -1, "roles.revoke") ?? false;
});
const defs = computed(() => authority?.PermissionDefs ?? []);

interface ScopeItem {
    id: string;
    label: string;
}

/** Items a permission can be limited to; null = the permission is not scopable. */
function scopeItemsFor(permissionId: string): ScopeItem[] | null {
    if (permissionId === "rules.edit") {
        return core.ModuleManager.getModule<Rules>("rules")?.Definitions.map((d) => ({ id: d.id, label: d.name })) ?? null;
    }
    if (permissionId === "curses.edit") {
        return core.ModuleManager.getModule<Curses>("curses")?.curseableGroups().map((g) => ({ id: g.Name as string, label: g.Description })) ?? null;
    }
    if (permissionId === "commands.use") {
        return core.ModuleManager.getModule<Commands>("commands")?.Definitions.map((d) => ({ id: d.id, label: d.name })) ?? null;
    }
    return null;
}

function scopeStatus(permissionId: string): string {
    const grants = role.value?.grants ?? [];
    if (grants.includes(permissionId)) {
        return "Everything";
    }
    const count = grants.filter((g) => g.startsWith(`${permissionId}:`)).length;
    return count > 0 ? `${count} selected` : "None";
}

function toggleGrant(permissionId: string): void {
    if (canEditGrants.value) {
        roles.setCustomRoleGrant(props.roleId, permissionId, !(role.value?.grants.includes(permissionId) ?? false));
        touch();
    }
}

function openScope(permissionId: string, label: string): void {
    const items = scopeItemsFor(permissionId);
    if (items) {
        nav.push({
            component: GrantScope,
            title: `${role.value?.name ?? "?"} - ${label}`,
            props: { roleId: props.roleId, permissionId, items },
        });
    }
}

function deleteRole(): void {
    roles.deleteCustomRole(props.roleId);
    touch();
    nav.pop();
}
</script>

<template>
    <div v-if="role" class="mx-auto flex max-w-3xl flex-col gap-3">
        <p class="px-3 text-sm text-fg-dim">
            Members: {{ role.members.length }} (assign on the Roles table). A custom role grants exactly
            the ticked permissions to its members, on top of whatever their rank already allows -
            grants are additive only.
        </p>
        <div class="flex flex-col gap-0.5">
            <template v-for="def in defs" :key="def.id">
                <div
                    v-if="scopeItemsFor(def.id)"
                    class="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface"
                    :class="{ 'opacity-60': !canEditGrants }"
                >
                    <span class="min-w-0 flex-1 truncate">{{ def.label }}</span>
                    <button
                        class="w-36 rounded-lg bg-surface px-3 py-1.5 hover:bg-surface-hover disabled:cursor-default"
                        style="border: 1px solid var(--bcp-border);"
                        :disabled="!canEditGrants"
                        title="Choose what this grant covers"
                        @click="openScope(def.id, def.label)"
                    >{{ scopeStatus(def.id) }}</button>
                </div>
                <label
                    v-else
                    class="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface"
                    :class="{ 'opacity-60': !canEditGrants }"
                >
                    <input
                        type="checkbox" class="h-5 w-5" style="accent-color: var(--bcp-accent);"
                        :checked="role.grants.includes(def.id)" :disabled="!canEditGrants"
                        @change="toggleGrant(def.id)"
                    >
                    <span>{{ def.label }}</span>
                </label>
            </template>
        </div>
        <div v-if="canDelete" class="border-t pt-3" style="border-color: var(--bcp-border);">
            <button
                class="rounded-lg px-4 py-2"
                style="background: rgba(224,82,82,0.15); border: 1px solid #e05252; color: #e05252;"
                title="Removes the role and all its assignments"
                @click="deleteRole()"
            >Delete this role</button>
        </div>
    </div>
    <p v-else class="text-fg-dim">This role no longer exists.</p>
</template>
