import { RuleAccess } from "@/system/rules/RuleAccess";
import { RuleDefinition, RuleStateData, defaultRuleState } from "@/system/rules/RuleTypes";
import { ContractDraft, ContractRuleSpec } from "@/system/contracts/ContractTypes";
import { sanitizeConditions } from "@/system/conditions/Conditions";
import type { ConditionData } from "@/system/conditions/Conditions";
import type { RulePunishConfig } from "@/system/punishments/PunishmentTypes";
import type Rules from "@/modules/Rules";

/**
 * RuleAccess over a contract draft: the full rule config UI edits the
 * draft's specs instead of anyone's live rules. Everything is local to
 * the author's client; nothing here touches live rule state.
 */
export class DraftRuleAccess implements RuleAccess {

    constructor(
        private readonly rules: Rules,
        private readonly draft: ContractDraft,
    ) {}

    private spec(id: string): ContractRuleSpec | undefined {
        return this.draft.rules[id];
    }

    /** Creates the spec on first touch, seeded from the rule's defaults. */
    private ensureSpec(id: string): ContractRuleSpec {
        let spec = this.draft.rules[id];
        if (!spec) {
            const definition = this.rules.getDefinition(id);
            const defaults = definition ? defaultRuleState(definition) : undefined;
            spec = {
                active: true,
                enforce: true,
                log: true,
                announce: true,
                useGlobal: true,
                settings: defaults?.settings ?? {},
            };
            this.draft.rules[id] = spec;
        }
        return spec;
    }

    definitions(): RuleDefinition[] {
        return this.rules.Definitions;
    }

    state(id: string): RuleStateData {
        const spec = this.spec(id);
        const definition = this.rules.getDefinition(id);
        const base = definition ? defaultRuleState(definition) : {
            active: false, enforce: true, log: true, announce: true, settings: {},
        };
        if (!spec) {
            base.active = false;
            return base;
        }
        return {
            active: spec.active,
            enforce: spec.enforce,
            log: spec.log,
            announce: spec.announce,
            useGlobal: spec.useGlobal,
            settings: { ...base.settings, ...spec.settings },
            conditions: spec.conditions,
        };
    }

    order(): string[] {
        return Object.keys(this.draft.rules);
    }

    sortMode(): "custom" | "category" {
        return "category";
    }

    canEdit(): boolean {
        // Drafting touches nobody's state - always editable by its author
        return true;
    }

    setActive(id: string, value: boolean): void {
        this.ensureSpec(id).active = value;
    }

    setEnforce(id: string, value: boolean): void {
        this.ensureSpec(id).enforce = value;
    }

    setLog(id: string, value: boolean): void {
        this.ensureSpec(id).log = value;
    }

    setAnnounce(id: string, value: boolean): void {
        this.ensureSpec(id).announce = value;
    }

    setSetting(id: string, name: string, value: unknown): void {
        this.ensureSpec(id).settings[name] = value;
    }

    setConditions(id: string, conditions: ConditionData): void {
        const sanitized = sanitizeConditions(conditions);
        const spec = this.ensureSpec(id);
        if (!sanitized || Object.keys(sanitized).length === 0) {
            delete spec.conditions;
        } else {
            spec.conditions = sanitized;
        }
    }

    globalConditions(): ConditionData {
        // The draft cannot know the future signer's global set
        return {};
    }

    setGlobalConditions(): void {
        // Not part of a contract
    }

    setUseGlobal(id: string, value: boolean): void {
        this.ensureSpec(id).useGlobal = value;
    }

    weldLocked(): boolean {
        return false;
    }

    setPunish(_id: string, _config: RulePunishConfig): void {
        // Punishment attachments reference the signer's punishment
        // definitions, which a draft cannot know - not supported (v1)
    }
}
