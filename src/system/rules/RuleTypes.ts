import { GetDotedPathType, PatchHook } from "bondage-club-mod-sdk";
import { AnySetting } from "@/system/gui/Settings";
import { Role } from "@/system/Roles";

export type RuleCategory = "Speech" | "Social" | "Items" | "Protection" | "Sensory" | "Other";

/** Facilities available to a rule while it is active. */
export interface RuleContext {
    /** Installs a hook owned by this rule; removed automatically when the rule deactivates. */
    hook<TFunctionName extends string>(
        functionName: TFunctionName,
        priority: number,
        hook: PatchHook<GetDotedPathType<typeof globalThis, TFunctionName>>,
    ): void;

    /** Current value of one of this rule's custom settings. */
    setting<T>(name: string): T;

    /**
     * Runs a callback on an interval while the rule is installed; cleared
     * automatically when the rule deactivates.
     */
    interval(callback: () => void, ms: number): void;

    /** True when the rule applies at all (active and conditions met). */
    inEffect(): boolean;

    /** True when the rule should block the action. */
    isEnforced(): boolean;

    /** True when violations should be recorded. */
    isLogged(): boolean;

    /** Reports a violation that happened (rule active but not enforced). */
    trigger(target?: number | null): void;

    /** Reports a blocked attempt (rule enforced). */
    triggerAttempt(target?: number | null): void;

    /** Shows a local-only explanation to the player. */
    notify(message: string): void;

    /** The highest BC+ role the member holds toward the player. */
    highestRoleOf(memberNumber: number): Role;
}

export interface RuleDefinition {
    /** Unique id, conventionally `<category>.<name>` (e.g. `speech.forbidWhisper`) */
    id: string;
    name: string;
    description: string;
    category: RuleCategory;
    /** Custom configuration rendered on the rule's config page */
    settings?: AnySetting[];
    /**
     * Room announcement when a breach attempt is blocked; `{Name}` is replaced
     * with the player's name. Omit for rules that should never announce.
     */
    announceAttempt?: string;
    /** Room announcement when a violation happens (rule not enforced); falls back to announceAttempt. */
    announceViolation?: string;
    /** Called when the rule becomes active - install hooks via the context */
    load(ctx: RuleContext): void;
}

import type { ConditionData } from "@/system/conditions/Conditions";

/** Per-rule persisted state. */
export interface RuleStateData {
    active: boolean;
    enforce: boolean;
    log: boolean;
    /** Whether breaches are announced to the room as an action message */
    announce: boolean;
    settings: Record<string, unknown>;
    /** When the rule is in effect; absent = always while active */
    conditions?: ConditionData;
}

export function defaultRuleState(definition: RuleDefinition): RuleStateData {
    return {
        active: false,
        enforce: true,
        log: true,
        announce: true,
        settings: Object.fromEntries((definition.settings ?? []).map((s) => [s.name, s.default])),
    };
}
