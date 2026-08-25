<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { NAV_KEY } from "@/ui/nav";
import { catalogAssets } from "@/utils/AssetCatalog";

const props = defineProps<{
    group: AssetGroupName;
    /** Explains what picking does in this context. */
    note: string;
    /** Called with the chosen asset name; the picker pops itself. */
    pick: (assetName: string) => void;
}>();

const nav = inject(NAV_KEY)!;
const search = ref("");

const assets = computed(() => {
    const term = search.value.trim().toLocaleLowerCase();
    return catalogAssets(props.group).filter((asset) =>
        term.length === 0 || asset.Description.toLocaleLowerCase().includes(term));
});

function previewUrl(asset: Asset): string {
    return `${AssetGetPreviewPath(asset)}/${asset.Name}.png`;
}

function choose(asset: Asset): void {
    props.pick(asset.Name);
    nav.pop();
}
</script>

<template>
    <div class="flex h-full flex-col gap-3">
        <p class="text-sm text-fg-dim">{{ note }}</p>
        <input v-model="search" type="text" placeholder="Search items..." class="w-full">
        <div class="grid min-h-0 flex-1 grid-cols-4 content-start gap-2 overflow-y-auto md:grid-cols-6">
            <button
                v-for="asset in assets"
                :key="asset.Name"
                class="flex flex-col items-center gap-1 rounded-lg bg-surface p-2 hover:bg-surface-hover"
                style="border: 1px solid var(--bcp-border);"
                :title="asset.Description"
                @click="choose(asset)"
            >
                <img
                    :src="previewUrl(asset)"
                    class="h-20 w-20 object-contain"
                    loading="lazy"
                    alt=""
                    @error="($event.target as HTMLImageElement).style.visibility = 'hidden'"
                >
                <span class="w-full truncate text-center text-xs">{{ asset.Description }}</span>
            </button>
        </div>
        <p v-if="assets.length === 0" class="text-fg-dim">No items match.</p>
    </div>
</template>
