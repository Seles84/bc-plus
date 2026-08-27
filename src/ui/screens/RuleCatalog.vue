<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { NAV_KEY } from "@/ui/nav";
import { useBcpVersion } from "@/ui/composables";
import RuleConfig from "@/ui/screens/RuleConfig.vue";
import { LocalRuleAccess, RemoteRuleAccess } from "@/system/rules/RuleAccess";
import { bcpCharacter } from "@/ui/composables";
import type { RuleCategory, RuleDefinition } from "@/system/rules/RuleTypes";
import type Authority from "@/modules/Authority";
import type Rules from "@/modules/Rules";

const props = defineProps<{ member?: number }>();
const nav = inject(NAV_KEY)!;
const { version, core } = useBcpVersion();

const rules = core.ModuleManager.getModule<Rules>("rules")!;
const character = bcpCharacter(props.member);
// Never fall back to local access for a departed remote target
const dead = computed(() => {
    version.value;
    return props.member !== undefined && bcpCharacter(props.member) === null;
});
const access = character
    ? new RemoteRuleAccess(rules, core.ModuleManager.getModule<Authority>("authority"), character)
    : new LocalRuleAccess(rules);

const search = ref("");
const category = ref<RuleCategory | null>(null);

const categories = computed(() => {
    const present = new Set(rules.Definitions.map((d) => d.category));
    return (["Speech", "Social", "Body", "Items", "Protection", "Sensory", "Rooms", "Settings", "Pet", "Other"] as RuleCategory[])
        .filter((c) => present.has(c));
});

/** Inactive rules matching the search and category filters. */
const available = computed<RuleDefinition[]>(() => {
    version.value;
    const term = search.value.trim().toLocaleLowerCase();
    return rules.Definitions.filter((definition) => {
        if (access.state(definition.id).active) {
            return false;
        }
        if (category.value !== null && definition.category !== category.value) {
            return false;
        }
        return term.length === 0
            || definition.name.toLocaleLowerCase().includes(term)
            || definition.description.toLocaleLowerCase().includes(term);
    });
});

/** Opens the config without activating - the rule arms from there. */
function pick(definition: RuleDefinition): void {
    nav.pop();
    nav.push({ component: RuleConfig, title: definition.name, props: { ruleId: definition.id, member: props.member } });
}
</script>

<template>
    <p v-if="dead" class="text-fg-dim">They are no longer in this room.</p>
    <div v-else class="flex h-full flex-col gap-3">
        <input
            v-model="search"
            type="text"
            placeholder="Search rules..."
            class="w-full"
        >
        <div class="flex flex-wrap gap-1.5">
            <button
                class="rounded-full px-3 py-1 text-sm"
                :style="category === null
                    ? 'background: var(--bcp-accent); color: var(--bcp-on-accent);'
                    : 'background: var(--bcp-surface); border: 1px solid var(--bcp-border);'"
                @click="category = null"
            >All</button>
            <button
                v-for="entry in categories"
                :key="entry"
                class="rounded-full px-3 py-1 text-sm"
                :style="category === entry
                    ? 'background: var(--bcp-accent); color: var(--bcp-on-accent);'
                    : 'background: var(--bcp-surface); border: 1px solid var(--bcp-border);'"
                @click="category = category === entry ? null : entry"
            >{{ entry }}</button>
        </div>

        <div class="@container min-h-0 flex-1 overflow-y-auto">
            <div class="grid grid-cols-1 content-start gap-x-8 gap-y-0.5 @3xl:grid-cols-2 @6xl:grid-cols-3">
                <button
                    v-for="definition in available"
                    :key="definition.id"
                    class="min-w-0 rounded-lg px-3 py-2 text-left hover:bg-surface"
                    @click="pick(definition)"
                >
                    <span class="flex items-baseline gap-2">
                        <span class="min-w-0 truncate font-semibold">{{ definition.name }}</span>
                        <span class="shrink-0 text-xs text-fg-dim">{{ definition.category }}</span>
                    </span>
                    <span class="block truncate text-sm text-fg-dim">{{ definition.description }}</span>
                </button>
                <p v-if="available.length === 0" class="px-3 text-fg-dim">No rules match.</p>
            </div>
        </div>
    </div>
</template>
