<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { pushEscapeHandler } from "@/ui/modal-escape";

defineProps<{ title: string }>();

const emit = defineEmits<{ close: [] }>();

// Esc closes the modal before the window shell navigates back
let unregister: (() => void) | null = null;
onMounted(() => {
    unregister = pushEscapeHandler(() => emit("close"));
});
onUnmounted(() => unregister?.());
</script>

<template>
    <div
        class="absolute inset-0 z-50 flex items-center justify-center p-6"
        style="background: rgba(0, 0, 0, 0.5);"
        @click.self="emit('close')"
    >
        <div
            class="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-lg bg-bg"
            style="border: 1px solid var(--bcp-border); box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);"
        >
            <header class="flex shrink-0 items-center gap-2 px-4 py-2.5" style="border-bottom: 1px solid var(--bcp-border);">
                <span class="font-semibold text-accent">{{ title }}</span>
                <span class="flex-1"></span>
                <button class="rounded px-1.5 text-fg-dim hover:text-fg" title="Close (Esc)" @click="emit('close')">&#10005;</button>
            </header>
            <div class="min-h-0 flex-1 overflow-y-auto p-4">
                <slot />
            </div>
            <footer v-if="$slots.footer" class="flex shrink-0 items-center gap-2 px-4 py-3" style="border-top: 1px solid var(--bcp-border);">
                <slot name="footer" />
            </footer>
        </div>
    </div>
</template>
