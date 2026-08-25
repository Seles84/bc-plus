<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { NAV_KEY } from "@/ui/nav";
import { useBcpVersion } from "@/ui/composables";
import ContractDraftView from "@/ui/screens/ContractDraftView.vue";
import ContractReview from "@/ui/screens/ContractReview.vue";
import { describeContractDuration, describeContractPolicy, sanitizeContractPayload } from "@/system/contracts/ContractTypes";
import { decodeExport } from "@/utils/ExportImport";
import { bcpCharacter } from "@/ui/composables";
import { MemberNumberToName } from "@/utils/Messaging";
import { onMounted } from "vue";
import type { SignedContract } from "@/system/contracts/ContractTypes";
import type Contracts from "@/modules/Contracts";

const props = defineProps<{ member?: number }>();
const nav = inject(NAV_KEY)!;
const { version, touch, core } = useBcpVersion();

const contracts = core.ModuleManager.getModule<Contracts>("contracts")!;
const local = props.member === undefined;
const character = bcpCharacter(props.member);
const dead = !local && character === null;

onMounted(() => {
    if (character) {
        contracts.queryAuthored(character.MemberNumber);
    }
});

/** Remote view: the contracts YOU authored on this person. */
const authored = computed(() => {
    version.value;
    return character ? contracts.authoredOn(character.MemberNumber) : undefined;
});

function releaseAuthored(contractId: string): void {
    if (character) {
        contracts.requestRelease(character.MemberNumber, contractId);
        touch();
    }
}

const offer = computed(() => {
    version.value;
    return contracts.PendingOffer;
});
const signed = computed(() => {
    version.value;
    return Object.values(contracts.Signed);
});
const drafts = computed(() => {
    version.value;
    return Object.values(contracts.Drafts);
});

function remainingText(contract: SignedContract): string {
    if (contract.until === null) {
        return "until released";
    }
    const left = contract.until - Date.now();
    return left <= 0 ? "ending" : `${describeContractDuration(Math.ceil(left / 60_000))} left`;
}

function activeRuleCount(rules: Record<string, { active: boolean }>): number {
    return Object.values(rules).filter((r) => r.active).length;
}

function reviewOffer(): void {
    if (offer.value) {
        nav.push({
            component: ContractReview,
            title: `Contract - ${offer.value.title}`,
            props: { subject: { kind: "offer", payload: offer.value } },
        });
    }
}

function viewSigned(contract: SignedContract): void {
    nav.push({
        component: ContractReview,
        title: `Contract - ${contract.title}`,
        props: { subject: { kind: "signed", contract } },
    });
}

function openDraft(id: string, title: string): void {
    nav.push({ component: ContractDraftView, title: `Draft - ${title}`, props: { draftId: id } });
}

function newDraft(): void {
    const draft = contracts.createDraft();
    if (draft) {
        touch();
        openDraft(draft.id, draft.title);
    }
}

const codeDraft = ref("");
const codeError = ref(false);
function reviewCode(): void {
    const code = codeDraft.value.trim();
    if (code.length === 0) {
        return;
    }
    const payload = sanitizeContractPayload(decodeExport(code, "contract"));
    if (!payload) {
        codeError.value = true;
        return;
    }
    codeError.value = false;
    codeDraft.value = "";
    nav.push({
        component: ContractReview,
        title: `Contract - ${payload.title}`,
        props: { subject: { kind: "offer", payload } },
    });
}
</script>

<template>
    <p v-if="dead" class="text-fg-dim">They are no longer in this room.</p>

    <!-- Remote: contracts you authored on this person -->
    <div v-else-if="!local" class="flex h-full flex-col gap-2">
        <h3 class="px-3 font-semibold text-accent">Contracts you authored on {{ MemberNumberToName(props.member!) }}</h3>
        <p v-if="authored === undefined" class="px-3 text-fg-dim">Asking their client...</p>
        <p v-else-if="authored.length === 0" class="px-3 text-fg-dim">
            None - offer one from a draft on your own Contracts page.
        </p>
        <div v-else class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
            <div
                v-for="contract in authored"
                :key="contract.id"
                class="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface"
            >
                <span class="min-w-0 flex-1 truncate">"{{ contract.title }}"</span>
                <span class="max-w-md truncate text-sm text-fg-dim">
                    {{ activeRuleCount(contract.rules) }} rules - {{ remainingText(contract) }} - {{ describeContractPolicy(contract.policy) }}
                </span>
                <button
                    class="rounded-lg bg-surface px-3 py-1.5 hover:bg-surface-hover"
                    style="border: 1px solid var(--bcp-border);"
                    title="End this contract - their rules return to how they were"
                    @click="releaseAuthored(contract.id)"
                >Release</button>
            </div>
        </div>
        <p class="px-3 text-sm text-fg-dim">Their client answers only with contracts naming you as the author; releasing is validated on their side.</p>
    </div>

    <div v-else class="flex h-full flex-col gap-4">
        <section class="flex flex-col gap-1">
            <h3 class="px-3 font-semibold text-accent">Contracts binding you</h3>
            <button
                v-if="offer"
                class="flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface"
                @click="reviewOffer()"
            >
                <span class="min-w-0 flex-1 truncate font-semibold" style="color: #a97fe0;">
                    OFFER: "{{ offer.title }}" from {{ offer.authorName }}
                </span>
                <span class="shrink-0 text-sm" style="color: #a97fe0;">Awaiting your review</span>
            </button>
            <p v-if="signed.length === 0 && !offer" class="px-3 text-fg-dim">None.</p>
            <button
                v-for="contract in signed"
                :key="contract.id"
                class="flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface"
                @click="viewSigned(contract)"
            >
                <span class="min-w-0 flex-1 truncate">"{{ contract.title }}" - {{ contract.authorName }}</span>
                <span class="shrink-0 text-sm text-fg-dim">{{ activeRuleCount(contract.rules) }} rules - {{ remainingText(contract) }}</span>
            </button>
        </section>

        <section class="flex min-h-0 flex-1 flex-col gap-1">
            <h3 class="px-3 font-semibold text-accent">Your contract drafts (offered to others)</h3>
            <p v-if="drafts.length === 0" class="px-3 text-fg-dim">None yet.</p>
            <div class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
                <button
                    v-for="draft in drafts"
                    :key="draft.id"
                    class="flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface"
                    @click="openDraft(draft.id, draft.title)"
                >
                    <span class="min-w-0 flex-1 truncate">{{ draft.title }}</span>
                    <span class="shrink-0 text-sm text-fg-dim">
                        {{ activeRuleCount(draft.rules) }} rules - {{ describeContractDuration(draft.durationMin) }}
                    </span>
                </button>
            </div>
        </section>

        <div class="flex flex-wrap items-center gap-2 border-t pt-3" style="border-color: var(--bcp-border);">
            <button
                class="rounded-lg px-4 py-2 font-semibold"
                style="background: var(--bcp-accent); color: var(--bcp-on-accent);"
                @click="newDraft()"
            >New draft</button>
            <span class="flex-1"></span>
            <input
                v-model="codeDraft"
                type="text" class="w-72"
                placeholder="Paste a contract code..."
                @keydown.enter.prevent="reviewCode()"
            >
            <button
                class="rounded-lg bg-surface px-3 py-2 hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                @click="reviewCode()"
            >Review code</button>
        </div>
        <p v-if="codeError" class="px-3 text-sm" style="color: #e05252;">That is not a valid contract code.</p>
    </div>
</template>
