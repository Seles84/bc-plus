import { RuleDefinition, RuleStateData, defaultRuleState } from "@/system/rules/RuleTypes";
import { WELD_LOCKED_RULES } from "@/modules/Welding";
import { SendBCPMessage } from "@/utils/Messaging";
import { jsonClone } from "@/utils/BCUtils";
import type { ConditionData } from "@/system/conditions/Conditions";
import type { RulePunishConfig } from "@/system/punishments/PunishmentTypes";
import type Rules from "@/modules/Rules";
import type { BCXEquivalentStatus } from "@/modules/Rules";
import type Authority from "@/modules/Authority";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";

/**
 * Uniform interface the rules screens use, regardless of whose rules
 * are being viewed: the player's own (local) or another character's (remote).
 */
export interface RuleAccess {
    definitions(): RuleDefinition[];
    state(id: string): RuleStateData;
    /** The owner's custom display order (rule ids); read-only for remote viewers. */
    order(): string[];
    /** The owner's list sort preference. */
    sortMode(): "custom" | "category";
    canEdit(): boolean;
    setActive(id: string, value: boolean): void;
    setEnforce(id: string, value: boolean): void;
    setLog(id: string, value: boolean): void;
    setAnnounce(id: string, value: boolean): void;
    setSetting(id: string, name: string, value: unknown): void;
    setConditions(id: string, conditions: ConditionData): void;
    /** The shared conditions set that rules with `useGlobal` follow. */
    globalConditions(): ConditionData;
    setGlobalConditions(conditions: ConditionData): void;
    setUseGlobal(id: string, value: boolean): void;
    /** Whether a welded collar locks this rule (forced on, nobody may change it). */
    weldLocked(id: string): boolean;
    /** Sets the rule's punishment attachment; an empty list clears it. */
    setPunish(id: string, config: RulePunishConfig): void;
    /**
     * Status of the rule's BCX equivalent on the OWNER's client: live query
     * for the own view, the synced coverage map for remote characters.
     */
    bcxStatus(id: string): BCXEquivalentStatus;
    /** Queued-but-unsent remote edits (always 0 for local and draft access). */
    pendingCount(): number;
    /** Sends every queued edit to the target. No-op for local and draft access. */
    save(): void;
    /** Drops every queued edit without sending. No-op for local and draft access. */
    discard(): void;
}

/** Direct access to the player's own rules. */
export class LocalRuleAccess implements RuleAccess {

    constructor(private readonly rules: Rules) {}

    definitions(): RuleDefinition[] {
        return this.rules.Definitions;
    }

    state(id: string): RuleStateData {
        return this.rules.peekRuleState(id);
    }

    order(): string[] {
        return this.rules.RuleOrder;
    }

    sortMode(): "custom" | "category" {
        return this.rules.SortMode;
    }

    canEdit(): boolean {
        return this.rules.canEdit();
    }

    setActive(id: string, value: boolean): void {
        this.rules.setRuleActive(id, value);
    }

    setEnforce(id: string, value: boolean): void {
        this.rules.setRuleEnforce(id, value);
    }

    setLog(id: string, value: boolean): void {
        this.rules.setRuleLog(id, value);
    }

    setAnnounce(id: string, value: boolean): void {
        this.rules.setRuleAnnounce(id, value);
    }

    setSetting(id: string, name: string, value: unknown): void {
        this.rules.setRuleSetting(id, name, value);
    }

    setConditions(id: string, conditions: ConditionData): void {
        this.rules.setRuleConditions(id, conditions);
    }

    globalConditions(): ConditionData {
        return this.rules.GlobalConditions;
    }

    setGlobalConditions(conditions: ConditionData): void {
        this.rules.setGlobalConditions(conditions);
    }

    setUseGlobal(id: string, value: boolean): void {
        this.rules.setRuleUseGlobal(id, value);
    }

    weldLocked(id: string): boolean {
        return this.rules.isRuleWeldLocked(id);
    }

    setPunish(id: string, config: RulePunishConfig): void {
        this.rules.setRulePunish(id, config);
    }

    bcxStatus(id: string): BCXEquivalentStatus {
        return this.rules.bcxEquivalentStatus(id);
    }

    // Local edits apply directly - nothing ever queues
    pendingCount(): number {
        return 0;
    }

    save(): void {}

    discard(): void {}
}

interface PendingRuleEdit {
    action: string;
    rule: string;
    name?: string;
    value: unknown;
}

/**
 * Unsent remote rule edits, keyed by target member number. Module-scoped so
 * every screen editing the same character (list, config, conditions editor)
 * shares one batch; it survives navigation until saved or discarded.
 */
const pendingRuleEdits = new Map<number, PendingRuleEdit[]>();

/** Queued-but-unsent remote rule edit counts per member (window close guard). */
export function pendingRuleEditCounts(): Map<number, number> {
    const counts = new Map<number, number>();
    for (const [member, edits] of pendingRuleEdits) {
        if (edits.length > 0) {
            counts.set(member, edits.length);
        }
    }
    return counts;
}

/** Drops a member's queued remote rule edits without sending them. */
export function discardPendingRuleEdits(member: number): void {
    pendingRuleEdits.delete(member);
}

/** Applies one queued edit onto a rule state (shared by the read overlay and the optimistic save). */
function applyEditToState(state: RuleStateData, edit: PendingRuleEdit): void {
    switch (edit.action) {
        case "setActive": state.active = edit.value === true; break;
        case "setEnforce": state.enforce = edit.value === true; break;
        case "setLog": state.log = edit.value === true; break;
        case "setAnnounce": state.announce = edit.value === true; break;
        case "setUseGlobal": state.useGlobal = edit.value === true; break;
        case "setSetting":
            if (typeof edit.name === "string") {
                state.settings[edit.name] = edit.value;
            }
            break;
        case "setConditions": state.conditions = edit.value as ConditionData; break;
        case "setPunish": {
            const config = edit.value as RulePunishConfig | undefined;
            if (!config || config.punishments.length === 0) {
                delete state.punish;
            } else {
                state.punish = config;
            }
            break;
        }
    }
}

/**
 * Access to another character's rules: reads the mirror synced via DataSync,
 * overlaid with the local batch of unsent edits. Writes only queue - the
 * editor keeps working against the overlay lag-free - until save() sends the
 * whole batch for the target's client to validate and apply (or reject).
 * The target's CategorySync reply is the authoritative correction.
 */
export class RemoteRuleAccess implements RuleAccess {

    constructor(
        private readonly rules: Rules,
        private readonly authority: Authority | undefined,
        private readonly character: BCPlusCharacter,
    ) {}

    definitions(): RuleDefinition[] {
        return this.rules.Definitions;
    }

    state(id: string): RuleStateData {
        const stored = this.mirror()?.[id];
        const definition = this.rules.getDefinition(id);
        const base = stored
            ?? (definition ? defaultRuleState(definition) : { active: false, enforce: false, log: false, announce: false, settings: {} });
        // Unsent edits overlay the mirror at read time, so the view shows
        // them even after a fresh sync from the target replaces the mirror
        const edits = this.pending.filter((e) => e.rule === id);
        if (edits.length === 0) {
            return base;
        }
        const overlaid = jsonClone(base);
        for (const edit of edits) {
            applyEditToState(overlaid, edit);
        }
        return overlaid;
    }

    order(): string[] {
        const raw = this.character.BCPData?.["rules"]?.["ruleOrder"];
        return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
    }

    sortMode(): "custom" | "category" {
        return this.character.BCPData?.["rules"]?.["ruleSort"] === "custom" ? "custom" : "category";
    }

    /** Best-effort preview using the target's synced authority/roles data; the target enforces for real. */
    canEdit(): boolean {
        return this.authority?.remoteHasPermission(this.character, "rules.edit") ?? false;
    }

    setActive(id: string, value: boolean): void {
        this.queue("setActive", id, undefined, value);
    }

    setEnforce(id: string, value: boolean): void {
        this.queue("setEnforce", id, undefined, value);
    }

    setLog(id: string, value: boolean): void {
        this.queue("setLog", id, undefined, value);
    }

    setAnnounce(id: string, value: boolean): void {
        this.queue("setAnnounce", id, undefined, value);
    }

    setSetting(id: string, name: string, value: unknown): void {
        this.queue("setSetting", id, name, value);
    }

    setConditions(id: string, conditions: ConditionData): void {
        this.queue("setConditions", id, undefined, conditions);
    }

    globalConditions(): ConditionData {
        const pendingGlobal = [...this.pending].reverse().find((e) => e.action === "setGlobalConditions");
        if (pendingGlobal) {
            return pendingGlobal.value as ConditionData;
        }
        const raw = this.character.BCPData?.["rules"]?.["globalConditions"];
        return (typeof raw === "object" && raw !== null ? raw : {}) as ConditionData;
    }

    setGlobalConditions(conditions: ConditionData): void {
        this.queue("setGlobalConditions", "", undefined, conditions);
    }

    setUseGlobal(id: string, value: boolean): void {
        this.queue("setUseGlobal", id, undefined, value);
    }

    weldLocked(id: string): boolean {
        return this.character.BCPData?.["welding"]?.["welded"] === true && WELD_LOCKED_RULES.includes(id);
    }

    setPunish(id: string, config: RulePunishConfig): void {
        this.queue("setPunish", id, undefined, config);
    }

    /** The target's synced BCX coverage map (published by their client; older versions lack it). */
    bcxStatus(id: string): BCXEquivalentStatus {
        const raw = this.character.BCPData?.["rules"]?.["bcxRules"];
        const value = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>)[id] : undefined;
        return value === "inEffect" || value === "active" ? value : "none";
    }

    pendingCount(): number {
        return this.pending.length;
    }

    /**
     * Sends every queued edit. Targets on this version get one
     * RuleCommandBatch (one validation pass, one notification, one reply,
     * one data sync); older targets get the edits as individual commands.
     * The mirror is updated optimistically so the view holds until the
     * target's authoritative sync arrives.
     */
    save(): void {
        const edits = this.pending;
        if (edits.length === 0) {
            return;
        }
        pendingRuleEdits.delete(this.character.MemberNumber);
        for (const edit of edits) {
            this.applyToMirror(edit);
        }
        if (this.supportsBatch()) {
            SendBCPMessage({ message: "RuleCommandBatch", commands: edits }, this.character.MemberNumber);
        } else {
            for (const edit of edits) {
                this.send(edit.action, edit.rule, edit.name, edit.value);
            }
        }
    }

    discard(): void {
        pendingRuleEdits.delete(this.character.MemberNumber);
    }

    private get pending(): PendingRuleEdit[] {
        return pendingRuleEdits.get(this.character.MemberNumber) ?? [];
    }

    /** Queues an edit, replacing an earlier queued edit of the same field. */
    private queue(action: string, rule: string, name: string | undefined, value: unknown): void {
        const edits = pendingRuleEdits.get(this.character.MemberNumber) ?? [];
        const replaced = edits.findIndex((e) => e.action === action && e.rule === rule && e.name === name);
        if (replaced >= 0) {
            edits.splice(replaced, 1);
        }
        edits.push({ action, rule, name, value });
        pendingRuleEdits.set(this.character.MemberNumber, edits);
    }

    /**
     * Batched commands shipped in the same release as the synced BCX coverage
     * map - its presence in the mirror is the capability probe (the key
     * exists, possibly empty, on every client of that version).
     */
    private supportsBatch(): boolean {
        return this.character.BCPData?.["rules"]?.["bcxRules"] !== undefined;
    }

    private applyToMirror(edit: PendingRuleEdit): void {
        if (edit.action === "setGlobalConditions") {
            this.character.BCPData ??= {};
            const moduleData = (this.character.BCPData["rules"] ??= { rules: {} });
            moduleData["globalConditions"] = edit.value;
            return;
        }
        applyEditToState(this.ensureMirror(edit.rule), edit);
    }

    private mirror(): Record<string, RuleStateData> | undefined {
        const moduleData = this.character.BCPData?.["rules"];
        return moduleData?.["rules"] as Record<string, RuleStateData> | undefined;
    }

    private ensureMirror(id: string): RuleStateData {
        this.character.BCPData ??= {};
        const moduleData = (this.character.BCPData["rules"] ??= { rules: {} });
        const store = (moduleData["rules"] ??= {}) as Record<string, RuleStateData>;
        store[id] ??= this.state(id);
        return store[id];
    }

    private send(action: string, rule: string, name: string | undefined, value: unknown): void {
        SendBCPMessage({
            message: "RuleCommand",
            action,
            rule,
            name,
            value,
        }, this.character.MemberNumber);
    }
}
