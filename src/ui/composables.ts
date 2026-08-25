import { inject, onMounted, onUnmounted, ref } from "vue";
import { BCPLUS_KEY } from "@/ui/nav";
import type { BCPlus } from "@/index";

/**
 * Bridges BC+'s non-reactive module data into Vue: returns a version counter
 * that bumps on every save sync and remote character sync, plus a `touch` to
 * bump after local mutations. Read `version.value` inside a computed and it
 * re-evaluates whenever the underlying data may have changed.
 */
export function useBcpVersion(): { version: ReturnType<typeof ref<number>>; touch: () => void; core: BCPlus } {
    const core = inject(BCPLUS_KEY)!;
    const version = ref(0);
    const touch = (): void => {
        version.value = (version.value ?? 0) + 1;
    };
    const unsubscribers: (() => void)[] = [];
    onMounted(() => {
        unsubscribers.push(core.Events.on("saveSynced", touch));
        unsubscribers.push(core.Events.on("characterSyncReceived", () => touch()));
    });
    onUnmounted(() => {
        for (const unsubscribe of unsubscribers.splice(0)) {
            unsubscribe();
        }
    });
    return { version, touch, core };
}
