<script setup lang="ts">
import { computed, inject } from "vue";
import { BCPLUS_KEY, NAV_KEY, WINDOW_KEY } from "@/ui/nav";
import ModuleSettings from "@/ui/screens/ModuleSettings.vue";
import { BCPLUS_REPO, BCPLUS_VERSION } from "@/system/Constants";
import { BCPVersionCompare, parseBCPVersion } from "@/utils/Version";
import type { ModuleInstance } from "@/system/module/ModuleInstance";
import type { GUI } from "@/modules/GUI";
import type Core from "@/modules/Core";

const core = inject(BCPLUS_KEY)!;
const nav = inject(NAV_KEY)!;
const win = inject(WINDOW_KEY)!;

const modules = computed(() => core.ModuleManager.Modules.filter((m) => m.HasGUI && m.Config.Active));

/** Settings-driven modules render natively; custom screens still open the classic canvas view. */
function isDomNative(module: ModuleInstance): boolean {
    return module.SettingsScreen === null && module.Settings.length > 0;
}

function openModule(module: ModuleInstance): void {
    if (isDomNative(module)) {
        nav.push({
            component: ModuleSettings,
            title: module.Config.MenuString || module.Config.Name,
            props: { slug: module.Slug },
        });
    } else {
        // Not ported to the new window yet - the classic view takes over
        win.close();
        core.ModuleManager.getModule<GUI>("gui")?.openCanvasModule(module);
    }
}

function openExportImport(): void {
    win.close();
    core.ModuleManager.getModule<GUI>("gui")?.openCanvasExport();
}

function openChangelog(): void {
    window.open(`${BCPLUS_REPO}/blob/main/CHANGE-LOG.md`, "_blank");
}

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
        <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
            <button
                v-for="module in modules"
                :key="module.Slug"
                class="flex items-center gap-3 rounded-lg bg-surface p-3 text-left hover:bg-surface-hover"
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
                        {{ isDomNative(module) ? module.Config.Description : "Opens in the classic view" }}
                    </span>
                </span>
            </button>
        </div>

        <div class="mt-auto flex flex-wrap items-center gap-3 border-t pt-3" style="border-color: var(--bcp-border);">
            <div class="min-w-0 flex-1 text-sm text-fg-dim">
                <div>BC+ v{{ BCPLUS_VERSION }} &middot; {{ modeText }}</div>
                <div v-if="updateText" :class="updateText.fresh ? 'text-fg-dim' : 'text-accent'">{{ updateText.text }}</div>
            </div>
            <button
                class="rounded-lg bg-surface px-4 py-2 hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                @click="openExportImport()"
            >Export / Import</button>
            <button
                class="rounded-lg bg-surface px-4 py-2 hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                @click="openChangelog()"
            >Changelog</button>
        </div>
    </div>
</template>
