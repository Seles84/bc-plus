<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from "vue";
import { NAV_KEY } from "@/ui/nav";
import { useBcpVersion } from "@/ui/composables";
import PersonPicker from "@/ui/screens/PersonPicker.vue";
import type Welding from "@/modules/Welding";

const nav = inject(NAV_KEY)!;
const { version, touch, core } = useBcpVersion();

const welding = core.ModuleManager.getModule<Welding>("welding")!;

// The ceremony countdown and checklist need a clock, not just data changes
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
    ticker = setInterval(() => {
        now.value = Date.now();
    }, 1_000);
});
onUnmounted(() => {
    if (ticker !== null) {
        clearInterval(ticker);
    }
});

const info = computed(() => {
    version.value;
    now.value;
    return welding.WeldInfo;
});
const ceremony = computed(() => {
    version.value;
    now.value;
    return welding.Ceremony;
});

const checklist = computed(() => {
    now.value;
    const ownership = Player.Ownership;
    const hasCollar = ownership !== undefined && typeof ownership?.MemberNumber === "number" && ownership.Stage === 1;
    const ownerHere = hasCollar && ChatRoomCharacter.some((c) => c.MemberNumber === ownership.MemberNumber);
    const friendHere = ChatRoomCharacter.some((c) =>
        typeof c.MemberNumber === "number"
        && c.MemberNumber !== Player.MemberNumber
        && c.MemberNumber !== ownership?.MemberNumber
        && Player.FriendList?.includes(c.MemberNumber));
    return [
        { ok: hasCollar, label: "You are fully collared (not on trial)" },
        { ok: ownerHere, label: "Your owner is in this room" },
        { ok: friendHere, label: "A BC friend of yours is in this room to witness" },
    ];
});
const canInitiate = computed(() => checklist.value[0]!.ok && checklist.value[1]!.ok);

const countdown = computed(() => {
    const deadline = ceremony.value?.deadline ?? 0;
    const remaining = Math.max(0, deadline - now.value);
    const minutes = Math.floor(remaining / 60_000);
    const seconds = Math.floor((remaining % 60_000) / 1000);
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
});

const lastError = ref<string | null>(null);
function run(action: () => true | string): void {
    const result = action();
    lastError.value = result === true ? null : result;
    touch();
}

function chooseWitness(): void {
    nav.push({
        component: PersonPicker,
        title: "Choose witness",
        props: {
            excluded: [ceremony.value?.owner ?? -1],
            onPick: (member: number) => run(() => welding.setWitness(member)),
        },
    });
}

const me = computed(() => Player.MemberNumber ?? -1);

const announceAnniversary = computed(() => {
    version.value;
    return welding.Data.announceAnniversary !== false;
});
const showWeldInfo = computed(() => {
    version.value;
    return welding.Data.showWeldInfo !== false;
});
function togglePref(key: "announceAnniversary" | "showWeldInfo"): void {
    welding.Data[key] = welding.Data[key] === false;
    touch();
}
</script>

<template>
    <div class="mx-auto flex max-w-3xl flex-col gap-4">
        <div class="rounded-lg bg-surface p-4 text-sm" style="border: 1px solid var(--bcp-border);">
            <p class="pb-2">Welding the collar makes your BC ownership as permanent as BC+ can make it:</p>
            <ul class="list-disc pl-5 text-fg-dim">
                <li>The rule "Forbid club owner changes" is forced on, enforced, and locked - nobody can pause, deactivate or condition it, not even your owner or you.</li>
                <li>The BC+ factory reset is disabled and the Rules module cannot be switched off.</li>
                <li>Re-importing rules cannot remove the lock.</li>
            </ul>
            <p class="pt-2">The ONLY thing that undoes a weld is your owner releasing you in BC itself.</p>
            <p class="pt-2 text-fg-dim">
                It takes your owner (full collar - no trial), you, and a witness who is a BC friend of yours -
                all three online in this room, all accepting within 10 minutes. Take it seriously: this is meant to be forever.
            </p>
        </div>

        <!-- Welded -->
        <template v-if="info">
            <div class="rounded-lg p-4" style="background: rgba(224,82,82,0.12); border: 1px solid #e05252;">
                <p class="font-semibold" style="color: #e05252;">This collar is WELDED SHUT.</p>
                <p class="pt-1">Owner: {{ info.ownerName }} (#{{ info.owner }})</p>
                <p>Witnessed by {{ info.witnessName }}{{ info.weldedAt > 0 ? ` on ${new Date(info.weldedAt).toLocaleDateString()}` : "" }}</p>
                <p class="pt-1 text-sm text-fg-dim">It ends only when the owner releases the submissive in BC.</p>
            </div>
            <div class="flex flex-col gap-1">
                <label class="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface">
                    <input
                        type="checkbox" class="h-5 w-5" style="accent-color: var(--bcp-accent);"
                        :checked="announceAnniversary" @change="togglePref('announceAnniversary')"
                    >
                    <span>Announce weld anniversaries in the room</span>
                </label>
                <label class="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface">
                    <input
                        type="checkbox" class="h-5 w-5" style="accent-color: var(--bcp-accent);"
                        :checked="showWeldInfo" @change="togglePref('showWeldInfo')"
                    >
                    <span>Show the welded-by line on my profile</span>
                </label>
            </div>
        </template>

        <!-- Ceremony running -->
        <template v-else-if="ceremony">
            <p class="font-semibold" style="color: #e05252;">Welding in progress - {{ countdown }} left</p>
            <div class="flex flex-col gap-1">
                <div
                    v-for="row in [
                        { role: 'Owner', name: ceremony.ownerName, member: ceremony.owner },
                        { role: 'Submissive', name: ceremony.subName, member: ceremony.sub },
                        { role: 'Witness', name: ceremony.witnessName ?? 'not chosen yet', member: ceremony.witness },
                    ]"
                    :key="row.role"
                    class="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface"
                >
                    <span class="w-28 text-fg-dim">{{ row.role }}</span>
                    <span class="min-w-0 flex-1 truncate">{{ row.member !== null ? `${row.name} (#${row.member})` : row.name }}</span>
                    <span
                        v-if="row.member !== null"
                        class="text-sm font-semibold"
                        :style="{ color: ceremony.accepted.includes(row.member) ? '#4caf6d' : 'var(--bcp-text-dim)' }"
                    >{{ ceremony.accepted.includes(row.member) ? "Accepted" : "Waiting..." }}</span>
                </div>
            </div>
            <div class="flex flex-wrap gap-2">
                <button
                    class="rounded-lg px-4 py-2 font-semibold disabled:opacity-50"
                    style="background: var(--bcp-accent); color: var(--bcp-bg);"
                    :disabled="ceremony.accepted.includes(me)"
                    @click="run(() => welding.accept(me))"
                >Accept</button>
                <button
                    class="rounded-lg bg-surface px-4 py-2 hover:bg-surface-hover"
                    style="border: 1px solid var(--bcp-border);"
                    title="A BC friend of yours, present in this room"
                    @click="chooseWitness()"
                >{{ ceremony.witness === null ? "Choose witness..." : "Change witness..." }}</button>
                <button
                    class="rounded-lg px-4 py-2"
                    style="background: rgba(224,82,82,0.15); border: 1px solid #e05252; color: #e05252;"
                    @click="run(() => welding.decline(me))"
                >Decline / cancel</button>
            </div>
        </template>

        <!-- Checklist -->
        <template v-else>
            <div class="flex flex-col gap-1">
                <h3 class="px-3 font-semibold text-accent">Requirements</h3>
                <div v-for="check in checklist" :key="check.label" class="flex items-center gap-3 px-3 py-1">
                    <span :style="{ color: check.ok ? '#4caf6d' : '#e05252' }">{{ check.ok ? "✓" : "✗" }}</span>
                    <span :class="{ 'text-fg-dim': !check.ok }">{{ check.label }}</span>
                </div>
            </div>
            <div>
                <button
                    class="rounded-lg px-4 py-2 font-semibold disabled:opacity-50"
                    style="background: var(--bcp-accent); color: var(--bcp-bg);"
                    :disabled="!canInitiate"
                    title="Starts the 10-minute three-way vetting - your owner is asked to accept"
                    @click="run(() => welding.startCeremony(me))"
                >Initiate welding</button>
            </div>
        </template>

        <p v-if="lastError" class="px-3 text-sm" style="color: #e05252;">That did not work: {{ lastError }}.</p>
    </div>
</template>
