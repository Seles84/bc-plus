<script setup lang="ts">
import { computed, inject, onMounted } from "vue";
import { NAV_KEY, WINDOW_KEY } from "@/ui/nav";
import MainMenu from "@/ui/screens/MainMenu.vue";
import Welcome from "@/ui/screens/Welcome.vue";
import MemberPickerModal from "@/ui/components/MemberPickerModal.vue";
import { BCPLUS_KEY } from "@/ui/nav";
import { PICKER_KEY, PickerService } from "@/ui/picker";
import { MemberNumberToName } from "@/utils/Messaging";
import { provide } from "vue";
import type Core from "@/modules/Core";

const core = inject(BCPLUS_KEY)!;
const nav = inject(NAV_KEY)!;
const win = inject(WINDOW_KEY)!;

/** One member-picker modal serves every screen in this window. */
const picker = new PickerService();
provide(PICKER_KEY, picker);

const current = computed(() => nav.stack[nav.stack.length - 1]);

onMounted(() => {
    if (nav.stack.length === 0) {
        const member = win.Viewing;
        const firstRun = member === null
            && (core.ModuleManager.getModule("core") as Core | undefined)?.isFirstRun() === true;
        if (firstRun) {
            nav.push({ component: Welcome, title: "Welcome" });
            return;
        }
        nav.push({
            component: MainMenu,
            title: member === null ? "Main Menu" : `${MemberNumberToName(member)} (#${member})`,
            props: member === null ? undefined : { member },
        });
    }
});
</script>

<template>
    <div
        class="relative flex h-full flex-col overflow-hidden bg-bg text-fg"
        style="border: 1px solid var(--bcp-border); border-radius: 10px;"
    >
        <header
            class="flex h-11 shrink-0 select-none items-center gap-2 bg-surface px-3"
            style="border-bottom: 1px solid var(--bcp-border);"
            @pointerdown.self="win.startDrag($event)"
        >
            <button
                v-if="nav.depth > 1"
                class="rounded px-2 py-0.5 text-fg-dim hover:bg-surface-hover hover:text-fg"
                title="Back (Esc)"
                @click="nav.pop()"
            >&#8592;</button>
            <span class="font-semibold text-accent">BC+</span>
            <span class="truncate text-fg-dim">{{ current?.title }}</span>
            <span class="flex-1 cursor-move self-stretch" @pointerdown="win.startDrag($event)"></span>
            <button
                class="rounded px-2 py-0.5 text-fg-dim hover:bg-surface-hover hover:text-fg"
                :title="win.minimized.value ? 'Restore' : 'Minimize'"
                @click="win.toggleMinimize()"
            >&#8211;</button>
            <button
                class="rounded px-2 py-0.5 text-fg-dim hover:bg-surface-hover hover:text-fg"
                :title="win.maximized.value ? 'Restore size' : 'Maximize'"
                @click="win.toggleMaximize()"
            >&#9633;</button>
            <button
                class="rounded px-2 py-0.5 text-fg-dim hover:bg-surface-hover hover:text-fg"
                title="Close"
                @click="win.close()"
            >&#10005;</button>
        </header>
        <main v-show="!win.minimized.value" class="min-h-0 flex-1 overflow-y-auto p-5">
            <component :is="current.component" v-bind="current.props" v-if="current" :key="nav.depth" />
        </main>

        <MemberPickerModal
            v-if="picker.state.request && !win.minimized.value"
            :key="picker.state.request.title + picker.state.request.multi"
            :request="picker.state.request"
            @finish="picker.finish($event)"
        />
    </div>
</template>
