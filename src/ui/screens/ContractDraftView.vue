<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { NAV_KEY } from "@/ui/nav";
import { useBcpVersion, useNow } from "@/ui/composables";
import ChooseRule from "@/ui/screens/ChooseRule.vue";
import RuleConfig from "@/ui/screens/RuleConfig.vue";
import { PICKER_KEY } from "@/ui/picker";
import { DraftRuleAccess } from "@/system/contracts/DraftRuleAccess";
import { describeContractDuration, describeContractPolicy } from "@/system/contracts/ContractTypes";
import { describeConditions } from "@/system/conditions/Conditions";
import { copyExportCode } from "@/utils/ExportImport";
import type Contracts from "@/modules/Contracts";
import type Rules from "@/modules/Rules";

const props = defineProps<{ draftId: string }>();
const nav = inject(NAV_KEY)!;
const picker = inject(PICKER_KEY)!;
const { version, touch, core } = useBcpVersion();
const now = useNow();

const contracts = core.ModuleManager.getModule<Contracts>("contracts")!;
const rules = core.ModuleManager.getModule<Rules>("rules")!;

const draft = computed(() => {
    version.value;
    return contracts.Drafts[props.draftId];
});

const DURATION_STEPS = [0, 30, 60, 6 * 60, 12 * 60, 24 * 60, 3 * 24 * 60, 7 * 24 * 60, 14 * 24 * 60, 30 * 24 * 60];

const included = computed(() => {
    version.value;
    const current = draft.value;
    if (!current) {
        return [];
    }
    return Object.keys(current.rules)
        .filter((id) => current.rules[id]!.active && rules.getDefinition(id))
        .map((id) => ({ id, definition: rules.getDefinition(id)!, spec: current.rules[id]! }));
});

function commitTitle(event: Event): void {
    const value = (event.target as HTMLInputElement).value.trim();
    if (draft.value && value.length > 0) {
        draft.value.title = value;
        touch();
    }
}

function commitTerms(event: Event): void {
    if (draft.value) {
        draft.value.terms = (event.target as HTMLTextAreaElement).value;
        touch();
    }
}

function setDuration(event: Event): void {
    if (draft.value) {
        draft.value.durationMin = Number((event.target as HTMLSelectElement).value);
        touch();
    }
}

function togglePolicy(): void {
    if (draft.value) {
        draft.value.policy = draft.value.policy === "author" ? "either" : "author";
        touch();
    }
}

function configureRule(id: string, name: string): void {
    if (!draft.value) {
        return;
    }
    nav.push({
        component: RuleConfig,
        title: `Contract rule - ${name}`,
        props: { ruleId: id, access: new DraftRuleAccess(rules, draft.value), draft: true },
    });
}

function removeRule(id: string): void {
    if (draft.value) {
        delete draft.value.rules[id];
        touch();
    }
}

function addRule(): void {
    nav.push({
        component: ChooseRule,
        title: "Add rule to contract",
        props: {
            exclude: included.value.map((entry) => entry.id),
            pick: (ruleId: string) => {
                const current = draft.value;
                const definition = rules.getDefinition(ruleId);
                if (!current || !definition) {
                    return;
                }
                const access = new DraftRuleAccess(rules, current);
                access.setActive(ruleId, true);
                touch();
                configureRule(ruleId, definition.name);
            },
        },
    });
}

function copyOffer(): void {
    if (draft.value) {
        copyExportCode(contracts.offerCode(draft.value));
    }
}

function offerToSomeone(): void {
    void picker.pickPerson({ title: "Offer the contract to..." }).then((member) => {
        if (member !== null && draft.value) {
            contracts.offerTo(draft.value, member);
        }
    });
}

const deleteArmedUntil = ref(0);
function deleteDraft(): void {
    if (Date.now() < deleteArmedUntil.value) {
        contracts.removeDraft(props.draftId);
        touch();
        nav.pop();
    } else {
        deleteArmedUntil.value = Date.now() + 5_000;
    }
}

function ruleSummary(entry: (typeof included.value)[number]): string {
    const spec = entry.spec;
    const conditions = spec.useGlobal !== false && !spec.conditions
        ? "signer's global conditions"
        : describeConditions(spec.conditions);
    return `${spec.enforce ? "Enforced" : "Not enforced"} - ${conditions}`;
}
</script>

<template>
    <div v-if="draft" class="mx-auto flex max-w-3xl flex-col gap-4">
        <section class="flex flex-col gap-2">
            <div class="flex items-center gap-3">
                <span class="w-28">Title:</span>
                <input type="text" class="flex-1" maxlength="60" :value="draft.title" @change="commitTitle($event)">
            </div>
            <div class="flex items-start gap-3">
                <span class="w-28 pt-1">Terms:</span>
                <textarea
                    class="min-h-20 flex-1 rounded-md p-2"
                    style="background: var(--bcp-bg); border: 1px solid var(--bcp-border); color: var(--bcp-text); font: inherit;"
                    maxlength="1000"
                    placeholder="Free-text terms, shown to the signer on the review screen"
                    :value="draft.terms"
                    @change="commitTerms($event)"
                ></textarea>
            </div>
            <div class="flex flex-wrap items-center gap-3">
                <span class="w-28">Duration:</span>
                <select :value="String(draft.durationMin)" @change="setDuration($event)">
                    <option v-for="minutes in DURATION_STEPS" :key="minutes" :value="String(minutes)">
                        {{ describeContractDuration(minutes) }}
                    </option>
                </select>
                <button
                    class="rounded-lg bg-surface px-3 py-1.5 hover:bg-surface-hover"
                    style="border: 1px solid var(--bcp-border);"
                    title="Who may end the contract early"
                    @click="togglePolicy()"
                >{{ describeContractPolicy(draft.policy) }}</button>
            </div>
        </section>

        <section class="flex flex-col gap-1">
            <h3 class="px-3 font-semibold text-accent">Rules in this contract ({{ included.length }})</h3>
            <div
                v-for="entry in included"
                :key="entry.id"
                class="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface"
            >
                <button
                    class="min-w-0 flex-1 truncate text-left hover:text-accent"
                    title="Configure how this rule applies at signing"
                    @click="configureRule(entry.id, entry.definition.name)"
                >{{ entry.definition.name }}</button>
                <span class="max-w-sm truncate text-sm text-fg-dim">{{ ruleSummary(entry) }}</span>
                <button
                    class="rounded px-2 py-1 text-fg-dim hover:text-accent"
                    title="Remove from the contract"
                    @click="removeRule(entry.id)"
                >&#10005;</button>
            </div>
            <button
                class="mx-3 mt-1 self-start rounded-lg bg-surface px-4 py-2 hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                @click="addRule()"
            >Add rule...</button>
        </section>

        <section class="flex flex-wrap gap-2 border-t pt-3" style="border-color: var(--bcp-border);">
            <button
                class="rounded-lg bg-surface px-4 py-2 hover:bg-surface-hover disabled:opacity-50"
                style="border: 1px solid var(--bcp-border);"
                :disabled="included.length === 0"
                title="A code the target can review and sign"
                @click="copyOffer()"
            >Copy offer code</button>
            <button
                class="rounded-lg bg-surface px-4 py-2 hover:bg-surface-hover disabled:opacity-50"
                style="border: 1px solid var(--bcp-border);"
                :disabled="included.length === 0"
                title="Send the offer to a person in this room"
                @click="offerToSomeone()"
            >Offer to someone here...</button>
            <span class="flex-1"></span>
            <button
                class="rounded-lg px-4 py-2"
                :style="now < deleteArmedUntil
                    ? 'background: rgba(224,82,82,0.25); border: 1px solid #e05252; color: #e05252;'
                    : 'background: rgba(224,82,82,0.15); border: 1px solid #e05252; color: #e05252;'"
                title="Removes this draft (signed contracts are unaffected)"
                @click="deleteDraft()"
            >{{ now < deleteArmedUntil ? "Confirm delete" : "Delete draft" }}</button>
        </section>
    </div>
    <p v-else class="text-fg-dim">This draft no longer exists.</p>
</template>
