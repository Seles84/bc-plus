import { inject, onMounted, onUnmounted, ref } from "vue";
import { BCPLUS_KEY } from "@/ui/nav";
import { getChatroomCharacter } from "@/utils/BCPlusCharacter";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";
import type { BCPlus } from "@/index";

/** The BC+ wrapper for a remote member, or null for the own view. */
export function bcpCharacter(member: number | undefined): BCPlusCharacter | null {
    return member === undefined ? null : getChatroomCharacter(member);
}

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
        // Remote views re-resolve their target when the room roster changes
        unsubscribers.push(core.Events.on("roomMembersChanged", () => touch()));
        // Remote request-response flows (log/stats/relationships fetches)
        unsubscribers.push(core.Events.on("logReceived", () => touch()));
        unsubscribers.push(core.Events.on("statsReceived", () => touch()));
        unsubscribers.push(core.Events.on("relationshipsReceived", () => touch()));
    });
    onUnmounted(() => {
        for (const unsubscribe of unsubscribers.splice(0)) {
            unsubscribe();
        }
    });
    return { version, touch, core };
}
