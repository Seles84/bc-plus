<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { WINDOW_KEY } from "@/ui/nav";
import { useBcpVersion } from "@/ui/composables";
import { copyExportCode, decodeExport, encodeExport } from "@/utils/ExportImport";
import { jsonClone } from "@/utils/BCUtils";
import type { GUI } from "@/modules/GUI";
import type Curses from "@/modules/Curses";
import type Relationships from "@/modules/Relationships";
import type Rules from "@/modules/Rules";

const win = inject(WINDOW_KEY)!;
const { version, touch, core } = useBcpVersion();

const rules = core.ModuleManager.getModule<Rules>("rules");
const curses = core.ModuleManager.getModule<Curses>("curses");
const relationships = core.ModuleManager.getModule<Relationships>("relationships");

interface Section {
    key: string;
    label: string;
    unit: string;
    info: string;
    canExport: boolean;
    canImport: boolean;
    doExport: () => void;
    doImport: (code: string) => number;
}

function importAll(code: string): number {
    const payload = decodeExport(code, "all");
    if (typeof payload !== "object" || payload === null) {
        return 0;
    }
    const parts = payload as { rules?: unknown; curses?: unknown; relationships?: unknown };
    let applied = 0;
    if (parts.rules !== undefined && rules) {
        applied += rules.importCode(encodeExport("rules", parts.rules));
    }
    if (parts.curses !== undefined && curses) {
        applied += curses.importCode(encodeExport("curses", parts.curses));
    }
    if (parts.relationships !== undefined && relationships) {
        applied += relationships.importCode(encodeExport("relationships", parts.relationships));
    }
    return applied;
}

const sections = computed<Section[]>(() => {
    version.value;
    return [
        {
            key: "rules",
            label: "Rules",
            unit: "rule",
            info: `${rules?.Definitions.length ?? 0} rules`,
            canExport: rules !== undefined,
            canImport: rules?.canEdit() ?? false,
            doExport: () => copyExportCode(rules!.exportCode()),
            doImport: (code) => rules!.importCode(code),
        },
        {
            key: "curses",
            label: "Curses",
            unit: "cursed slot",
            info: `${Object.keys(curses?.Slots ?? {}).length} cursed slots`,
            canExport: curses !== undefined,
            canImport: curses?.canEdit() ?? false,
            doExport: () => copyExportCode(curses!.exportCode()),
            doImport: (code) => curses!.importCode(code),
        },
        {
            key: "relationships",
            label: "Relationships",
            unit: "custom name",
            info: `${Object.keys(relationships?.Entries ?? {}).length} custom names`,
            canExport: relationships !== undefined,
            canImport: relationships?.canEdit() ?? false,
            doExport: () => copyExportCode(relationships!.exportCode()),
            doImport: (code) => relationships!.importCode(code),
        },
        {
            key: "all",
            label: "Everything",
            unit: "item",
            info: "rules + curses + relationships in one code",
            canExport: rules !== undefined && curses !== undefined && relationships !== undefined,
            canImport: (rules?.canEdit() ?? false) && (curses?.canEdit() ?? false) && (relationships?.canEdit() ?? false),
            doExport: () => copyExportCode(encodeExport("all", {
                rules: rules!.exportPayload(),
                curses: jsonClone(curses!.Data.slots),
                relationships: jsonClone(relationships!.Data.entries),
            })),
            doImport: (code) => importAll(code),
        },
    ];
});

/** Which section's import field is open, its draft and the last result. */
const importOpen = ref<string | null>(null);
const importDraft = ref("");
const importResult = ref<string | null>(null);

function toggleImport(key: string): void {
    importOpen.value = importOpen.value === key ? null : key;
    importDraft.value = "";
    importResult.value = null;
}

function applyImport(section: Section): void {
    const code = importDraft.value.trim();
    if (code.length === 0) {
        return;
    }
    const applied = section.doImport(code);
    importResult.value = applied > 0
        ? `Imported ${applied} ${section.unit}${applied === 1 ? "" : "s"}.`
        : "That code could not be read.";
    importDraft.value = "";
    touch();
}

const exported = ref<string | null>(null);
function runExport(section: Section): void {
    section.doExport();
    exported.value = section.key;
}

const bcxInstalled = computed(() => core.SDK.bcxInstalled());
function openMigration(): void {
    win.close();
    core.ModuleManager.getModule<GUI>("gui")?.openCanvasMigration();
}
</script>

<template>
    <div class="mx-auto flex max-w-3xl flex-col gap-3">
        <p class="px-3 text-sm text-fg-dim">
            Export copies a shareable BCP1 code to your clipboard; Import applies a pasted code.
            Importing requires the matching edit permission.
        </p>
        <div
            v-for="section in sections"
            :key="section.key"
            class="rounded-lg bg-surface p-3"
            style="border: 1px solid var(--bcp-border);"
        >
            <div class="flex items-center gap-3">
                <span class="min-w-0 flex-1">
                    <span class="block font-semibold">{{ section.label }}</span>
                    <span class="block text-sm text-fg-dim">{{ section.info }}</span>
                </span>
                <button
                    class="rounded-lg bg-bg px-4 py-1.5 hover:bg-surface-hover disabled:opacity-50"
                    style="border: 1px solid var(--bcp-border);"
                    :disabled="!section.canExport"
                    :title="`Copy your ${section.label.toLocaleLowerCase()} as a shareable code`"
                    @click="runExport(section)"
                >{{ exported === section.key ? "Copied!" : "Export" }}</button>
                <button
                    class="rounded-lg bg-bg px-4 py-1.5 hover:bg-surface-hover disabled:opacity-50"
                    style="border: 1px solid var(--bcp-border);"
                    :disabled="!section.canImport"
                    :title="section.canImport ? 'Apply a pasted code' : 'Requires the matching edit permission'"
                    @click="toggleImport(section.key)"
                >Import</button>
            </div>
            <div v-if="importOpen === section.key" class="flex items-center gap-2 pt-2">
                <input
                    v-model="importDraft"
                    type="text" class="flex-1"
                    placeholder="Paste a BCP1 code..."
                    @keydown.enter.prevent="applyImport(section)"
                >
                <button
                    class="rounded-lg px-4 py-1.5 font-semibold"
                    style="background: var(--bcp-accent); color: var(--bcp-bg);"
                    @click="applyImport(section)"
                >Apply</button>
            </div>
            <p v-if="importOpen === section.key && importResult" class="pt-1 text-sm text-fg-dim">{{ importResult }}</p>
        </div>

        <div v-if="bcxInstalled" class="flex items-center gap-3 rounded-lg bg-surface p-3" style="border: 1px solid var(--bcp-border);">
            <span class="min-w-0 flex-1">
                <span class="block font-semibold">Migrate from BCX</span>
                <span class="block text-sm text-fg-dim">copy your BCX rules and curses into BC+ (opens in the classic view)</span>
            </span>
            <button
                class="rounded-lg bg-bg px-4 py-1.5 hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                @click="openMigration()"
            >Open...</button>
        </div>
    </div>
</template>
