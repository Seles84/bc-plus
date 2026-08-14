import { CurseItemSpec } from "@/system/curses/CurseTypes";
import type { Originator } from "@/system/module/ModuleTypes";

/**
 * A punishment definition: something that can happen to the player when a
 * rule with punishments attached is broken. Two kinds:
 * - item: an item (captured from the worn state, like curses) is applied and
 *   enforced for the duration - struggling out just brings it back.
 * - rule: another BC+ rule is forced active, enforced and unconditional for
 *   the duration, then returns to its previous state.
 */
export interface PunishmentDefinition {
    id: string;
    name: string;
    kind: "item" | "rule";
    /** Minutes the punishment lasts; 0 = until someone permitted lifts it */
    durationMin: number;
    /** Whether applying it is announced to the room */
    announce: boolean;
    /** item kind: the slot and the captured item to apply */
    group?: AssetGroupName;
    item?: CurseItemSpec;
    /** item kind: lock asset applied on the item ("" = none) */
    lock?: string;
    /** rule kind: the BC+ rule id that gets forced */
    rule?: string;
    addedBy?: Originator;
}

/**
 * A punishment currently running. Self-contained snapshot: editing or
 * deleting the definition never changes a punishment already in progress.
 */
export interface ActivePunishment {
    /** Definition id this was started from */
    punishment: string;
    name: string;
    kind: "item" | "rule";
    /** Rule id whose violation triggered it ("manual" for direct application) */
    sourceRule: string;
    startedAt: number;
    /** Unix ms end time; null = until lifted */
    until: number | null;
    /** Whether re-applications and the ending are announced to the room */
    announce?: boolean;
    group?: AssetGroupName;
    item?: CurseItemSpec;
    lock?: string;
    /** rule kind: the forced rule and its state before forcing */
    forcedRule?: string;
    priorActive?: boolean;
    priorEnforce?: boolean;
}

/** Per-rule punishment attachment, stored in the rule's state. */
export interface RulePunishConfig {
    /** Punishment definition ids applied when the threshold is reached */
    punishments: string[];
    /** Violations within the window needed to punish (1 = every violation) */
    threshold: number;
    /** Rolling counting window in minutes */
    windowMin: number;
    /** What a violation does while the punishment is already running */
    repeat: "restart" | "stack" | "ignore";
}

export function defaultPunishConfig(): RulePunishConfig {
    return { punishments: [], threshold: 1, windowMin: 5, repeat: "stack" };
}

/** Lock choices offered on item punishments (validated again at apply time). */
export const PUNISHMENT_LOCKS: readonly { asset: string; label: string }[] = [
    { asset: "", label: "No lock" },
    { asset: "MetalPadlock", label: "Metal padlock" },
    { asset: "IntricatePadlock", label: "Intricate padlock" },
    { asset: "ExclusivePadlock", label: "Exclusive padlock" },
];

/** Validates an untrusted punish config (remote command, import); null = invalid. */
export function sanitizePunishConfig(raw: unknown): RulePunishConfig | null {
    if (typeof raw !== "object" || raw === null) {
        return null;
    }
    const candidate = raw as Partial<RulePunishConfig>;
    if (!Array.isArray(candidate.punishments)) {
        return null;
    }
    const punishments = candidate.punishments
        .filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 40)
        .slice(0, 10);
    const threshold = Number.isInteger(candidate.threshold) ? Math.min(Math.max(candidate.threshold as number, 1), 50) : 1;
    const windowMin = Number.isInteger(candidate.windowMin) ? Math.min(Math.max(candidate.windowMin as number, 1), 1440) : 5;
    const repeat = candidate.repeat === "restart" || candidate.repeat === "ignore" ? candidate.repeat : "stack";
    return { punishments, threshold, windowMin, repeat };
}

export function describeDuration(durationMin: number): string {
    if (durationMin <= 0) {
        return "until lifted";
    }
    if (durationMin < 60) {
        return `${durationMin} min`;
    }
    const hours = Math.floor(durationMin / 60);
    const minutes = durationMin % 60;
    return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/** Remaining time of an active punishment, for display. */
export function describeRemaining(active: ActivePunishment): string {
    if (active.until === null) {
        return "until lifted";
    }
    const left = active.until - Date.now();
    if (left <= 0) {
        return "ending";
    }
    if (left < 60_000) {
        return `${Math.ceil(left / 1000)}s left`;
    }
    return `${Math.ceil(left / 60_000)} min left`;
}
