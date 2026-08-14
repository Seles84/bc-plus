import { RuleDefinition, RuleStateData, defaultRuleState } from "@/system/rules/RuleTypes";
import { SendBCPMessage } from "@/utils/Messaging";
import type { ConditionData } from "@/system/conditions/Conditions";
import type { RulePunishConfig } from "@/system/punishments/PunishmentTypes";
import type Rules from "@/modules/Rules";
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
    /** Sets the rule's punishment attachment; an empty list clears it. */
    setPunish(id: string, config: RulePunishConfig): void;
}

/** Direct access to the player's own rules. */
export class LocalRuleAccess implements RuleAccess {

    constructor(private readonly rules: Rules) {}

    definitions(): RuleDefinition[] {
        return this.rules.Definitions;
    }

    state(id: string): RuleStateData {
        return this.rules.ruleState(id);
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

    setPunish(id: string, config: RulePunishConfig): void {
        this.rules.setRulePunish(id, config);
    }
}

/**
 * Access to another character's rules: reads the mirror synced via DataSync,
 * writes by sending RuleCommand messages that the target's client validates
 * and applies (or rejects). Mirror updates are optimistic; the target's
 * CategorySync reply is the authoritative correction.
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
        if (stored) {
            return stored;
        }
        const definition = this.rules.getDefinition(id);
        return definition ? defaultRuleState(definition) : { active: false, enforce: false, log: false, announce: false, settings: {} };
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
        this.send("setActive", id, undefined, value);
        this.ensureMirror(id).active = value;
    }

    setEnforce(id: string, value: boolean): void {
        this.send("setEnforce", id, undefined, value);
        this.ensureMirror(id).enforce = value;
    }

    setLog(id: string, value: boolean): void {
        this.send("setLog", id, undefined, value);
        this.ensureMirror(id).log = value;
    }

    setAnnounce(id: string, value: boolean): void {
        this.send("setAnnounce", id, undefined, value);
        this.ensureMirror(id).announce = value;
    }

    setSetting(id: string, name: string, value: unknown): void {
        this.send("setSetting", id, name, value);
        this.ensureMirror(id).settings[name] = value;
    }

    setConditions(id: string, conditions: ConditionData): void {
        this.send("setConditions", id, undefined, conditions);
        this.ensureMirror(id).conditions = conditions;
    }

    globalConditions(): ConditionData {
        const raw = this.character.BCPData?.["rules"]?.["globalConditions"];
        return (typeof raw === "object" && raw !== null ? raw : {}) as ConditionData;
    }

    setGlobalConditions(conditions: ConditionData): void {
        this.send("setGlobalConditions", "", undefined, conditions);
        this.character.BCPData ??= {};
        const moduleData = (this.character.BCPData["rules"] ??= { rules: {} });
        moduleData["globalConditions"] = conditions;
    }

    setUseGlobal(id: string, value: boolean): void {
        this.send("setUseGlobal", id, undefined, value);
        this.ensureMirror(id).useGlobal = value;
    }

    setPunish(id: string, config: RulePunishConfig): void {
        this.send("setPunish", id, undefined, config);
        if (config.punishments.length === 0) {
            delete this.ensureMirror(id).punish;
        } else {
            this.ensureMirror(id).punish = config;
        }
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
