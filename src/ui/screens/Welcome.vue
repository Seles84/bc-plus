<script setup lang="ts">
import { inject, ref } from "vue";
import { BCPLUS_KEY, NAV_KEY } from "@/ui/nav";
import MainMenu from "@/ui/screens/MainMenu.vue";
import { BCPLUS_APP_NAME, BCPLUS_VERSION } from "@/system/Constants";
import type { BCPPreset } from "@/modules/Core";
import type Core from "@/modules/Core";

const core = inject(BCPLUS_KEY)!;
const nav = inject(NAV_KEY)!;

const coreModule = core.ModuleManager.getModule("core") as Core | undefined;
const step = ref<"intro" | "preset">("intro");

const PRESET_CHOICES: { preset: BCPPreset; blurb: string }[] = [
    {
        preset: "Dominant",
        blurb: "You hold the keys. Rules, curses and the log never apply to you, and your permissions "
            + "start fully closed - nobody gets access unless you open it. BC+ is your toolkit for managing others.",
    },
    {
        preset: "Switch",
        blurb: "The balanced middle: everything available, permissions at sensible defaults "
            + "(your Owners and Mistresses can manage you; you keep full self-access).",
    },
    {
        preset: "Submissive",
        blurb: "Ready for the receiving end: anyone may view your BC+, your Owners and Mistresses can "
            + "manage you - and you keep control of your own settings.",
    },
    {
        preset: "Slave",
        blurb: "Hands off the wheel: after a confirmation, you lose self-access to your rules, curses, "
            + "permissions, roles, relationships and log clearing. Only those you empower can change "
            + "them - and only they can give control back.",
    },
];

function finish(): void {
    coreModule?.completeFirstRun();
    nav.reset({ component: MainMenu, title: "Main Menu" });
}

function choose(preset: BCPPreset): void {
    // The choice confirms via the BC+ modal; declining stays on this step
    void coreModule?.choosePreset(preset).then((applied) => {
        if (applied) {
            finish();
        }
    });
}
</script>

<template>
    <div class="mx-auto flex max-w-3xl flex-col gap-4">
        <template v-if="step === 'intro'">
            <h2 class="text-lg font-semibold text-accent">Welcome to {{ BCPLUS_APP_NAME }}</h2>
            <p class="text-fg-dim">BC+ v{{ BCPLUS_VERSION }} is now part of your club life. A quick tour:</p>
            <ul class="flex list-disc flex-col gap-1.5 pl-5">
                <li><strong>Rules</strong> - restrictions on speech, items, movement and more, with conditions and timers.</li>
                <li><strong>Curses</strong> - lock item slots so only permitted items can be worn.</li>
                <li><strong>Roles &amp; Authority</strong> - decide exactly who may do what to you, from your BC Owner down to custom roles you invent with hand-picked permissions.</li>
                <li><strong>Commands</strong> - one-shot orders like kneeling or forced speech.</li>
                <li><strong>Log</strong> - a private record of everything that happens under BC+.</li>
            </ul>
            <p class="text-fg-dim">
                Everything others can do to you is controlled by your permissions, and your own client
                always has the final word. Type <code>/bcp help</code> in chat for quick commands.
            </p>
            <p v-if="core.Mode === 'tandem'" class="text-fg-dim">
                BCX detected: BC+ runs alongside it and stays out of its way.
            </p>
            <div>
                <button
                    class="rounded-lg px-5 py-2.5 font-semibold"
                    style="background: var(--bcp-accent); color: var(--bcp-on-accent);"
                    @click="step = 'preset'"
                >Choose a preset...</button>
            </div>
        </template>

        <template v-else>
            <h2 class="text-lg font-semibold text-accent">How do you play?</h2>
            <p class="text-fg-dim">
                Pick the preset that fits you - it configures your permissions to match and then
                locks in. Only a factory reset clears it.
            </p>
            <button
                v-for="choice in PRESET_CHOICES"
                :key="choice.preset"
                class="flex items-start gap-4 rounded-lg bg-surface p-4 text-left hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                @click="choose(choice.preset)"
            >
                <span class="w-32 shrink-0 font-semibold">{{ choice.preset }}</span>
                <span class="min-w-0 text-sm text-fg-dim">{{ choice.blurb }}</span>
            </button>
            <div>
                <button
                    class="rounded-lg bg-surface px-4 py-2 hover:bg-surface-hover"
                    style="border: 1px solid var(--bcp-border);"
                    @click="finish()"
                >Decide later (Switch)</button>
            </div>
        </template>
    </div>
</template>
