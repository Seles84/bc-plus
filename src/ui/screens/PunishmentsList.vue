<script setup lang="ts">
import { computed, inject } from "vue";
import { NAV_KEY } from "@/ui/nav";
import { useBcpVersion } from "@/ui/composables";
import AssetPicker from "@/ui/screens/AssetPicker.vue";
import ChooseRule from "@/ui/screens/ChooseRule.vue";
import PunishmentConfig from "@/ui/screens/PunishmentConfig.vue";
import SlotGrid from "@/ui/screens/SlotGrid.vue";
import { LocalPunishmentAccess, RemotePunishmentAccess } from "@/system/punishments/PunishmentAccess";
import {
    PUNISHMENT_LOCKS, PunishmentDefinition, describeDuration, describeRemaining,
} from "@/system/punishments/PunishmentTypes";
import { bcpCharacter } from "@/ui/composables";
import type Authority from "@/modules/Authority";
import type Curses from "@/modules/Curses";
import type Punishments from "@/modules/Punishments";
import type Rules from "@/modules/Rules";

const props = defineProps<{ member?: number }>();
const nav = inject(NAV_KEY)!;
const { version, touch, core } = useBcpVersion();

const punishments = core.ModuleManager.getModule<Punishments>("punishments")!;
const local = props.member === undefined;
const character = bcpCharacter(props.member);
const dead = !local && character === null;
const access = character
    ? new RemotePunishmentAccess(core.ModuleManager.getModule<Authority>("authority"), character)
    : new LocalPunishmentAccess(punishments);
const rules = core.ModuleManager.getModule<Rules>("rules");

const canEdit = computed(() => {
    version.value;
    return access.canEdit();
});
const canLift = computed(() => {
    version.value;
    return access.canLift();
});

const running = computed(() => {
    version.value;
    return Object.values(access.active());
});
const defined = computed(() => {
    version.value;
    return Object.values(access.definitions());
});

function groupLabel(group: string | undefined): string {
    if (!group) {
        return "?";
    }
    return core.ModuleManager.getModule<Curses>("curses")
        ?.curseableGroups().find((g) => g.Name === group)?.Description ?? group;
}

function describeDefinition(definition: PunishmentDefinition): string {
    const duration = describeDuration(definition.durationMin);
    if (definition.kind === "rule") {
        return `Forces "${rules?.getDefinition(definition.rule ?? "")?.name ?? definition.rule ?? "?"}" - ${duration}`;
    }
    const lock = PUNISHMENT_LOCKS.find((l) => l.asset === (definition.lock ?? ""));
    const lockText = lock && lock.asset !== "" ? `, ${lock.label.toLocaleLowerCase()}` : "";
    return `${groupLabel(definition.group)} - ${duration}${lockText}`;
}

function sourceText(entry: (typeof running.value)[number]): string {
    return entry.sourceRule === "manual"
        ? "applied directly"
        : `broke "${rules?.getDefinition(entry.sourceRule)?.name ?? entry.sourceRule}"`;
}

function lift(id: string): void {
    access.lift(id);
    touch();
}

function openConfig(id: string): void {
    const name = access.definitions()[id]?.name ?? "Punishment";
    nav.push({ component: PunishmentConfig, title: `Punishment - ${name}`, props: { id, member: props.member } });
}

function newFromWorn(): void {
    nav.push({
        component: SlotGrid,
        title: "New item punishment",
        props: {
            note: "Click a slot to capture the item currently worn there as a punishment - wear and "
                + "configure the item (color, type, crafting) the way the punishment should apply it "
                + "first. Empty slots cannot become punishments.",
            slotState: (group: AssetGroup) => {
                const worn = InventoryGet(access.subject(), group.Name);
                return worn
                    ? { disabled: false, hover: `Capture: ${worn.Craft?.Name || worn.Asset.Description}` }
                    : { disabled: true, hover: "Nothing worn here" };
            },
            pick: (group: AssetGroupName) => {
                access.createFromWorn(group);
                touch();
                nav.pop();
            },
        },
    });
}

function newFromCatalog(): void {
    nav.push({
        component: SlotGrid,
        title: "New item punishment",
        props: {
            note: "Click a slot, then pick any item for it from the catalog - nothing has to be worn. "
                + "Catalog punishments apply the item in its default color and configuration.",
            slotState: () => ({ disabled: false, hover: "Browse items for this slot" }),
            pick: (group: AssetGroupName) => {
                nav.push({
                    component: AssetPicker,
                    title: `New punishment - ${groupLabel(group)}`,
                    props: {
                        group,
                        note: "Click an item to create a punishment applying it. Catalog picks apply the "
                            + "item in its default color and configuration; to punish with an exactly "
                            + "configured item, wear it and use 'New from worn item' instead.",
                        pick: (asset: string) => {
                            access.createFromCatalog(group, asset);
                            touch();
                            nav.pop();
                        },
                    },
                });
            },
        },
    });
}

function newRulePunishment(): void {
    nav.push({
        component: ChooseRule,
        title: "New rule punishment",
        props: {
            pick: (ruleId: string) => {
                access.createRule(ruleId);
                touch();
            },
        },
    });
}
</script>

<template>
    <p v-if="dead" class="text-fg-dim">They are no longer in this room.</p>
    <div v-else class="flex h-full flex-col gap-4">
        <section class="flex flex-col gap-1">
            <h3 class="px-3 font-semibold text-accent">Running punishments</h3>
            <p v-if="running.length === 0" class="px-3 text-fg-dim">None.</p>
            <div
                v-for="entry in running"
                :key="entry.punishment"
                class="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface"
            >
                <span class="min-w-0 flex-1 truncate">{{ entry.name }}</span>
                <span class="max-w-sm truncate text-sm text-fg-dim">{{ sourceText(entry) }} - {{ describeRemaining(entry) }}</span>
                <button
                    v-if="canLift"
                    class="rounded-lg bg-surface px-3 py-1 text-sm hover:bg-surface-hover"
                    style="border: 1px solid var(--bcp-border);"
                    title="End this punishment now"
                    @click="lift(entry.punishment)"
                >Lift</button>
            </div>
        </section>

        <section class="flex min-h-0 flex-1 flex-col gap-1">
            <h3 class="px-3 font-semibold text-accent">Defined punishments</h3>
            <p v-if="defined.length === 0" class="px-3 text-fg-dim">None yet - create one below.</p>
            <div class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
                <div
                    v-for="definition in defined"
                    :key="definition.id"
                    class="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface"
                    @click="openConfig(definition.id)"
                >
                    <span class="min-w-0 flex-1 truncate font-semibold">{{ definition.name }}</span>
                    <span class="max-w-md truncate text-sm text-fg-dim">{{ describeDefinition(definition) }}</span>
                </div>
            </div>
        </section>

        <div v-if="canEdit" class="flex flex-wrap gap-2 border-t pt-3" style="border-color: var(--bcp-border);">
            <button
                class="rounded-lg bg-surface px-4 py-2 hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                @click="newFromWorn()"
            >New from worn item...</button>
            <button
                class="rounded-lg bg-surface px-4 py-2 hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                @click="newFromCatalog()"
            >New from catalog...</button>
            <button
                class="rounded-lg bg-surface px-4 py-2 hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                @click="newRulePunishment()"
            >New rule punishment...</button>
        </div>
    </div>
</template>
