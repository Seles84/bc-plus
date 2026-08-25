<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { NAV_KEY } from "@/ui/nav";
import { useBcpVersion } from "@/ui/composables";
import {
    describeContractDuration, describeContractPolicy,
} from "@/system/contracts/ContractTypes";
import { describeConditions } from "@/system/conditions/Conditions";
import type { ContractPayload, ContractRuleSpec, SignedContract } from "@/system/contracts/ContractTypes";
import type Contracts from "@/modules/Contracts";
import type Rules from "@/modules/Rules";

type ReviewSubject =
    | { kind: "offer"; payload: ContractPayload }
    | { kind: "signed"; contract: SignedContract };

const props = defineProps<{ subject: ReviewSubject }>();
const nav = inject(NAV_KEY)!;
const { version, touch, core } = useBcpVersion();

const contracts = core.ModuleManager.getModule<Contracts>("contracts")!;
const rules = core.ModuleManager.getModule<Rules>("rules");

const terms = computed(() => (props.subject.kind === "offer" ? props.subject.payload : props.subject.contract));

const authorText = computed(() => {
    const t = terms.value as { authorName: string; author: number };
    return `${t.authorName} (#${t.author})`;
});

const durationText = computed(() => {
    version.value;
    if (props.subject.kind === "signed") {
        const contract = props.subject.contract;
        if (contract.until === null) {
            return "until released";
        }
        const left = contract.until - Date.now();
        return left <= 0 ? "ending" : `${describeContractDuration(Math.ceil(left / 60_000))} left`;
    }
    return describeContractDuration(terms.value.durationMin);
});

const specs = computed(() => {
    version.value;
    return Object.entries(terms.value.rules)
        .filter(([id, spec]) => spec.active && rules?.getDefinition(id))
        .map(([id, spec]) => ({ id, definition: rules!.getDefinition(id)!, spec }));
});

/** Compact non-default settings summary for the review rows. */
function describeSettings(spec: ContractRuleSpec, declared: { name: string; label: string }[]): string {
    const parts: string[] = [];
    for (const setting of declared) {
        const value = spec.settings[setting.name];
        if (value === undefined || value === false || value === "" || (Array.isArray(value) && value.length === 0)) {
            continue;
        }
        const text = Array.isArray(value) ? value.join(", ") : String(value);
        parts.push(`${setting.label.replace(/:$/, "")}: ${text === "true" ? "yes" : text}`);
    }
    return parts.join("; ").slice(0, 220);
}

function specSummary(entry: (typeof specs.value)[number]): string {
    const spec = entry.spec;
    const conditions = spec.useGlobal !== false && !spec.conditions
        ? "your global conditions"
        : describeConditions(spec.conditions);
    const settings = describeSettings(spec, entry.definition.settings ?? []);
    return `${spec.enforce ? "Enforced" : "Logged only"} - ${conditions}${settings ? ` - ${settings}` : ""}`;
}

const signArmedUntil = ref(0);
const signError = ref<string | null>(null);
function sign(): void {
    if (props.subject.kind !== "offer") {
        return;
    }
    if (Date.now() < signArmedUntil.value) {
        const result = contracts.sign(props.subject.payload);
        if (result === true) {
            touch();
            nav.pop();
        } else {
            signError.value = result;
            signArmedUntil.value = 0;
        }
    } else {
        signArmedUntil.value = Date.now() + 6_000;
    }
}

function decline(): void {
    if (props.subject.kind === "offer") {
        if (contracts.PendingOffer === props.subject.payload) {
            contracts.declineOffer();
        }
        touch();
        nav.pop();
    }
}

const canRelease = computed(() => {
    version.value;
    return props.subject.kind === "signed"
        && contracts.canReleaseLocally(props.subject.contract)
        && contracts.Signed[props.subject.contract.id] !== undefined;
});
const releaseArmedUntil = ref(0);
function release(): void {
    if (props.subject.kind !== "signed") {
        return;
    }
    if (Date.now() < releaseArmedUntil.value) {
        contracts.endContract(props.subject.contract.id, "released", Player.Nickname || Player.Name);
        touch();
        nav.pop();
    } else {
        releaseArmedUntil.value = Date.now() + 5_000;
    }
}
</script>

<template>
    <div class="mx-auto flex max-w-3xl flex-col gap-4">
        <section class="flex flex-col gap-1 rounded-lg bg-surface p-4" style="border: 1px solid var(--bcp-border);">
            <p>Author: <strong>{{ authorText }}</strong></p>
            <p>Duration: {{ durationText }} <span class="text-fg-dim">- {{ describeContractPolicy(terms.policy) }}</span></p>
            <p v-if="props.subject.kind === 'signed'" class="text-sm text-fg-dim">
                Signed {{ new Date(props.subject.contract.signedAt).toLocaleString() }}
            </p>
            <p v-if="terms.terms.trim().length > 0" class="whitespace-pre-wrap pt-2">{{ terms.terms.slice(0, 1000) }}</p>
        </section>

        <section class="flex flex-col gap-1">
            <h3 class="px-3 font-semibold text-accent">Rules ({{ specs.length }})</h3>
            <div
                v-for="entry in specs"
                :key="entry.id"
                class="rounded-lg px-3 py-2 hover:bg-surface"
            >
                <span class="block font-semibold">{{ entry.definition.name }}</span>
                <span class="block text-sm text-fg-dim">{{ specSummary(entry) }}</span>
            </div>
        </section>

        <section v-if="props.subject.kind === 'offer'" class="flex flex-wrap items-center gap-2 border-t pt-3" style="border-color: var(--bcp-border);">
            <button
                class="rounded-lg px-5 py-2.5 font-semibold"
                :style="Date.now() < signArmedUntil
                    ? 'background: #e05252; color: #fff;'
                    : 'background: var(--bcp-accent); color: var(--bcp-bg);'"
                title="Apply and seal every listed rule"
                @click="sign()"
            >{{ Date.now() < signArmedUntil ? "Click again to SIGN" : "Sign the contract" }}</button>
            <button
                class="rounded-lg bg-surface px-4 py-2.5 hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                @click="decline()"
            >Decline</button>
            <span v-if="Date.now() < signArmedUntil" class="text-sm text-fg-dim">
                Every listed rule applies immediately and stays sealed until the contract ends.
            </span>
        </section>
        <section v-else-if="canRelease" class="flex border-t pt-3" style="border-color: var(--bcp-border);">
            <button
                class="rounded-lg px-4 py-2"
                :style="Date.now() < releaseArmedUntil
                    ? 'background: rgba(224,82,82,0.25); border: 1px solid #e05252; color: #e05252;'
                    : 'background: var(--bcp-surface); border: 1px solid var(--bcp-border);'"
                title="Its policy allows either side to end it - the rules return to how they were"
                @click="release()"
            >{{ Date.now() < releaseArmedUntil ? "Confirm ending it" : "End the contract" }}</button>
        </section>
        <p v-if="signError" class="px-3 text-sm" style="color: #e05252;">Cannot sign: {{ signError }}.</p>
    </div>
</template>
