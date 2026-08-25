<script setup lang="ts">
import { computed, inject } from "vue";
import { BCPLUS_KEY, NAV_KEY } from "@/ui/nav";
import ModuleSettings from "@/ui/screens/ModuleSettings.vue";
import RulesList from "@/ui/screens/RulesList.vue";
import CursesList from "@/ui/screens/CursesList.vue";
import PunishmentsList from "@/ui/screens/PunishmentsList.vue";
import Authority from "@/ui/screens/Authority.vue";
import CommandsView from "@/ui/screens/CommandsView.vue";
import ContractsHub from "@/ui/screens/ContractsHub.vue";
import ExportImport from "@/ui/screens/ExportImport.vue";
import LogView from "@/ui/screens/LogView.vue";
import Relationships from "@/ui/screens/Relationships.vue";
import RolesView from "@/ui/screens/RolesView.vue";
import StatsView from "@/ui/screens/StatsView.vue";
import WeldingView from "@/ui/screens/WeldingView.vue";
import type { Component } from "vue";
import { BCPLUS_REPO, BCPLUS_VERSION } from "@/system/Constants";
import { BCPVersionCompare, parseBCPVersion } from "@/utils/Version";
import { MemberNumberToName } from "@/utils/Messaging";
import { getChatroomCharacter } from "@/utils/BCPlusCharacter";
import type { ModuleInstance } from "@/system/module/ModuleInstance";
import type Core from "@/modules/Core";

const props = defineProps<{
    /** Viewing another character's BC+ (remote menu). */
    member?: number;
}>();

const core = inject(BCPLUS_KEY)!;
const nav = inject(NAV_KEY)!;

const remote = computed(() => props.member !== undefined);

const modules = computed(() => core.ModuleManager.Modules.filter((m) =>
    (remote.value ? m.SupportsRemote : m.HasGUI && m.Config.Active)));

/** Custom screens already ported to the new window. */
const PORTED_SCREENS: Record<string, Component> = {
    rules: RulesList,
    curses: CursesList,
    punishments: PunishmentsList,
    roles: RolesView,
    authority: Authority,
    logging: LogView,
    statistics: StatsView,
    relationships: Relationships,
    commands: CommandsView,
    contracts: ContractsHub,
    welding: WeldingView,
};


function openModule(module: ModuleInstance): void {
    if (remote.value && !getChatroomCharacter(props.member!)) {
        return;
    }
    const name = module.Config.MenuString || module.Config.Name;
    const title = remote.value ? `${name} - ${MemberNumberToName(props.member!)}` : name;
    const ported = PORTED_SCREENS[module.Slug];
    if (ported) {
        nav.push({
            component: ported,
            title,
            props: remote.value ? { member: props.member } : undefined,
        });
    } else {
        nav.push({
            component: ModuleSettings,
            title,
            props: { slug: module.Slug, member: props.member },
        });
    }
}

function openExportImport(): void {
    nav.push({ component: ExportImport, title: "Export / Import" });
}

function openChangelog(): void {
    window.open(`${BCPLUS_REPO}/blob/main/CHANGE-LOG.md`, "_blank");
}

const targetVersion = computed(() => {
    if (props.member === undefined) {
        return null;
    }
    return getChatroomCharacter(props.member)?.BCPVersion ?? null;
});

const modeText = computed(() => (core.Mode === "tandem"
    ? `Tandem with BCX v${window.bcx?.version ?? "?"}`
    : "Control mode (BCX not found)"));

const updateText = computed(() => {
    const latest = core.ModuleManager.getModule<Core>("core")?.getLatestVersion();
    const mine = parseBCPVersion(BCPLUS_VERSION);
    const theirs = latest ? parseBCPVersion(latest) : null;
    if (!mine || !theirs) {
        return null;
    }
    return BCPVersionCompare(mine, theirs) >= 0
        ? { text: "This is the latest version", fresh: true }
        : { text: `${latest} is the latest version`, fresh: false };
});
</script>

<template>
    <div class="flex h-full flex-col gap-4">
        <div class="grid grid-cols-2 gap-4 md:grid-cols-3">
            <button
                v-for="module in modules"
                :key="module.Slug"
                class="flex items-center gap-3 rounded-lg bg-surface p-4 text-left hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                :title="module.Config.HoverText || module.Config.Description"
                @click="openModule(module)"
            >
                <img
                    v-if="module.Config.Icon"
                    :src="module.Config.Icon"
                    class="h-10 w-10 shrink-0"
                    alt=""
                >
                <span class="min-w-0">
                    <span class="block truncate font-semibold">{{ module.Config.MenuString || module.Config.Name }}</span>
                    <span class="block truncate text-sm text-fg-dim">
                        {{ module.Config.Description }}
                    </span>
                </span>
            </button>
        </div>

        <div class="mt-auto flex flex-wrap items-center gap-3 border-t pt-3" style="border-color: var(--bcp-border);">
            <div class="min-w-0 flex-1 text-sm text-fg-dim">
                <div v-if="remote">Viewing {{ MemberNumberToName(props.member!) }} (#{{ props.member }}) &middot; their client validates every change</div>
                <div v-if="remote && targetVersion">Their BC+: v{{ targetVersion }}</div>
                <div v-if="!remote">BC+ v{{ BCPLUS_VERSION }} &middot; {{ modeText }}</div>
                <div v-if="!remote && updateText" :class="updateText.fresh ? 'text-fg-dim' : 'text-accent'">{{ updateText.text }}</div>
            </div>
            <button
                v-if="!remote"
                class="rounded-lg bg-surface px-4 py-2 hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                @click="openExportImport()"
            >Export / Import</button>
            <button
                v-if="!remote"
                class="rounded-lg bg-surface px-4 py-2 hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                @click="openChangelog()"
            >Changelog</button>
        </div>
    </div>
</template>
