<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { NAV_KEY } from "@/ui/nav";
import { useBcpVersion } from "@/ui/composables";
import CustomRole from "@/ui/screens/CustomRole.vue";
import PersonPicker from "@/ui/screens/PersonPicker.vue";
import { Role, roleName } from "@/system/Roles";
import { MANUAL_ROLE_KEYS } from "@/modules/Roles";
import { MemberNumberToName, SendBCPMessage } from "@/utils/Messaging";
import { bcpCharacter } from "@/ui/composables";
import type { CustomRoleData, ManualRole } from "@/modules/Roles";
import type Authority from "@/modules/Authority";
import type Roles from "@/modules/Roles";

type AssignableRole = ManualRole | string;

interface RoleRow {
    role: Role | string;
    member: number;
    name: string;
    derived: boolean;
    empty?: boolean;
}

const props = defineProps<{ member?: number }>();
const nav = inject(NAV_KEY)!;
const { version, touch, core } = useBcpVersion();

const roles = core.ModuleManager.getModule<Roles>("roles")!;
const authority = core.ModuleManager.getModule<Authority>("authority");
const local = props.member === undefined;
const character = bcpCharacter(props.member);
const dead = !local && character === null;

const canAssign = computed(() => {
    version.value;
    if (!local) {
        return character !== null && (authority?.remoteHasPermission(character, "roles.assign") ?? false);
    }
    return authority?.hasPermission(Player.MemberNumber ?? -1, "roles.assign") ?? false;
});
const canRevoke = computed(() => {
    version.value;
    if (!local) {
        return character !== null && (authority?.remoteHasPermission(character, "roles.revoke") ?? false);
    }
    return authority?.hasPermission(Player.MemberNumber ?? -1, "roles.revoke") ?? false;
});

/** The role lists being shown: own live data, or the target's synced mirror. */
interface RolesData {
    owners: number[];
    mistresses: number[];
    customRoles: Record<string, Pick<CustomRoleData, "name" | "members">>;
}

const viewData = computed<RolesData>(() => {
    version.value;
    if (local) {
        return {
            owners: roles.manualList(Role.Owner),
            mistresses: roles.manualList(Role.Mistress),
            customRoles: roles.CustomRoles,
        };
    }
    const mirror = (character?.BCPData?.["roles"] ?? {}) as Record<string, unknown>;
    const numbers = (v: unknown): number[] => (Array.isArray(v) ? v.filter((m): m is number => typeof m === "number") : []);
    const customRoles: RolesData["customRoles"] = {};
    const raw = mirror.customRoles;
    if (raw && typeof raw === "object") {
        for (const [id, role] of Object.entries(raw as Record<string, Partial<CustomRoleData>>)) {
            if (role && typeof role.name === "string") {
                customRoles[id] = { name: role.name, members: numbers(role.members) };
            }
        }
    }
    return { owners: numbers(mirror.owners), mistresses: numbers(mirror.mistresses), customRoles };
});

function roleLabel(role: Role | string): string {
    version.value;
    return typeof role === "string" ? (viewData.value.customRoles[role]?.name ?? "?") : roleName(role);
}

const rows = computed<RoleRow[]>(() => {
    version.value;
    const view = viewData.value;
    const bc = character ? character.Character : Player;
    const result: RoleRow[] = [];
    const bcOwner = bc.Ownership && typeof bc.Ownership.MemberNumber === "number"
        ? bc.Ownership.MemberNumber
        : null;
    if (bcOwner !== null) {
        result.push({ role: Role.BCOwner, member: bcOwner, name: bc.Ownership!.Name, derived: true });
    }
    for (const member of view.owners) {
        result.push({ role: Role.Owner, member, name: MemberNumberToName(member), derived: false });
    }
    for (const lover of bc.Lovership ?? []) {
        if (typeof lover.MemberNumber === "number" && lover.MemberNumber !== bcOwner && !view.owners.includes(lover.MemberNumber)) {
            result.push({ role: Role.Lover, member: lover.MemberNumber, name: lover.Name, derived: true });
        }
    }
    for (const member of view.mistresses) {
        result.push({ role: Role.Mistress, member, name: MemberNumberToName(member), derived: false });
    }
    for (const [id, role] of Object.entries(view.customRoles)) {
        if (role.members.length === 0) {
            result.push({ role: id, member: -1, name: "(no members)", derived: false, empty: true });
        }
        for (const member of role.members) {
            result.push({ role: id, member, name: MemberNumberToName(member), derived: false });
        }
    }
    return result;
});

const assignable = computed<AssignableRole[]>(() => {
    version.value;
    return [
        ...(Object.keys(MANUAL_ROLE_KEYS).map(Number) as ManualRole[]),
        ...Object.keys(viewData.value.customRoles),
    ];
});
const addRole = ref<AssignableRole>(Role.Owner);
const addDraft = ref("");

function memberList(role: AssignableRole): number[] | null {
    if (typeof role === "string") {
        return viewData.value.customRoles[role]?.members ?? null;
    }
    return local ? roles.manualList(role) : (role === Role.Owner ? viewData.value.owners : viewData.value.mistresses);
}

/** Wire key for an assignable role, as the RoleCommand handler expects it. */
function wireKey(role: AssignableRole): string {
    return typeof role === "string" ? role : MANUAL_ROLE_KEYS[role];
}

function addMember(member: number): void {
    if (!Number.isInteger(member) || member < 0) {
        return;
    }
    if (!local) {
        // Their client validates roles.assign; the ACK'd sync refreshes us
        if (character && member !== character.MemberNumber) {
            SendBCPMessage({ message: "RoleCommand", action: "assign", role: wireKey(addRole.value), member }, character.MemberNumber);
        }
        return;
    }
    if (member === Player.MemberNumber) {
        return;
    }
    const list = memberList(addRole.value);
    if (list && !list.includes(member)) {
        list.push(member);
        touch();
    }
}

function addFromInput(): void {
    addMember(Number.parseInt(addDraft.value.trim(), 10));
    addDraft.value = "";
}

function browse(): void {
    nav.push({
        component: PersonPicker,
        title: `Assign as ${roleLabel(addRole.value)}`,
        props: {
            excluded: memberList(addRole.value) ?? [],
            onPick: (member: number) => addMember(member),
        },
    });
}

function removeRow(row: RoleRow): void {
    if (!local) {
        if (character) {
            SendBCPMessage({
                message: "RoleCommand",
                action: "revoke",
                role: wireKey(row.role as AssignableRole),
                member: row.member,
            }, character.MemberNumber);
        }
        return;
    }
    const list = memberList(row.role as AssignableRole);
    const index = list?.indexOf(row.member) ?? -1;
    if (list && index !== -1) {
        list.splice(index, 1);
        touch();
    }
}

function openCustomRole(id: string): void {
    nav.push({ component: CustomRole, title: `Role - ${roleLabel(id)}`, props: { roleId: id } });
}

const newRoleDraft = ref("");
const createError = ref(false);
function createRole(): void {
    const name = newRoleDraft.value.trim();
    if (name.length === 0) {
        return;
    }
    createError.value = roles.createCustomRole(name) === null;
    newRoleDraft.value = "";
    touch();
}

/** Serializes the role value for select binding (numbers and strings mixed). */
function roleKey(role: AssignableRole): string {
    return typeof role === "string" ? `c:${role}` : `r:${role}`;
}
function setAddRole(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    addRole.value = value.startsWith("c:") ? value.slice(2) : (Number(value.slice(2)) as ManualRole);
}
</script>

<template>
    <p v-if="dead" class="text-fg-dim">They are no longer in this room.</p>
    <div v-else class="flex h-full flex-col gap-3">
        <div class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
            <div class="flex items-center gap-3 px-3 pb-1 text-sm text-fg-dim">
                <span class="w-52">Role</span>
                <span class="w-28">ID</span>
                <span class="min-w-0 flex-1">Name</span>
                <span class="w-8"></span>
            </div>
            <p v-if="rows.length === 0" class="px-3 text-fg-dim">No role assignments yet.</p>
            <div
                v-for="(row, index) in rows"
                :key="`${String(row.role)}-${row.member}-${index}`"
                class="flex items-center gap-3 rounded-lg px-3 py-1.5 hover:bg-surface"
            >
                <button
                    v-if="local && typeof row.role === 'string'"
                    class="w-52 truncate rounded bg-surface px-2 py-1 text-left text-accent hover:bg-surface-hover"
                    style="border: 1px solid var(--bcp-border);"
                    title="Configure this role's permission grants"
                    @click="openCustomRole(row.role)"
                >{{ roleLabel(row.role) }}</button>
                <span v-else class="w-52 truncate">{{ roleLabel(row.role) }}</span>
                <span class="w-28 text-fg-dim">{{ row.empty ? "" : `#${row.member}` }}</span>
                <span class="min-w-0 flex-1 truncate" :class="{ 'text-fg-dim': row.empty }">{{ row.name }}</span>
                <span v-if="row.derived" class="shrink-0 text-sm text-fg-dim">from BC</span>
                <button
                    v-else-if="canRevoke && !row.empty"
                    class="w-8 rounded px-1 text-fg-dim hover:text-accent"
                    :title="`Remove ${row.name} from ${roleLabel(row.role)}`"
                    @click="removeRow(row)"
                >&#10005;</button>
            </div>
        </div>

        <div v-if="canAssign" class="flex flex-wrap items-center gap-2 border-t pt-3" style="border-color: var(--bcp-border);">
            <span>Add:</span>
            <select :value="roleKey(addRole)" @change="setAddRole($event)">
                <option v-for="role in assignable" :key="roleKey(role)" :value="roleKey(role)">{{ roleLabel(role) }}</option>
            </select>
            <input
                v-model="addDraft" type="text" inputmode="numeric" class="w-36"
                placeholder="Member number"
                @keydown.enter.prevent="addFromInput()"
            >
            <button
                class="rounded-lg bg-surface px-3 py-1.5 hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                @click="addFromInput()"
            >Add</button>
            <button
                class="rounded-lg bg-surface px-3 py-1.5 hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                title="Pick from room, friends and relationships"
                @click="browse()"
            >Browse...</button>
            <span class="flex-1"></span>
            <template v-if="local">
                <input
                    v-model="newRoleDraft" type="text" class="w-44" maxlength="30"
                    placeholder="New role name..."
                    @keydown.enter.prevent="createRole()"
                >
                <button
                    class="rounded-lg bg-surface px-3 py-1.5 hover:bg-surface-hover"
                    style="border: 1px solid var(--bcp-border);"
                    title="Create a custom role: a bundle of permission grants"
                    @click="createRole()"
                >Create role</button>
            </template>
        </div>
        <p v-else class="border-t px-3 pt-2 text-sm text-fg-dim" style="border-color: var(--bcp-border);">
            {{ canRevoke ? "You may remove assignments but not add new ones." : "You do not have permission to manage roles; viewing only." }}
        </p>
        <p v-if="createError" class="px-3 text-sm" style="color: #e05252;">
            Could not create the role (empty name or too many roles).
        </p>
    </div>
</template>
