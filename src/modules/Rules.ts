import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig, PermissionDefinition } from "@/system/module/ModuleTypes";
import { BCPLUS_AUTHOR, BCPLUS_VERSION } from "@/system/Constants";
import { Role } from "@/system/Roles";
import { RuleContext, RuleDefinition, RuleStateData, defaultRuleState } from "@/system/rules/RuleTypes";
import { RULE_DEFINITIONS } from "@/rules/index";
import { RulesListScreen } from "@/gui/RulesListScreen";
import { GUIScreen } from "@/system/gui/GUIScreen";
import { BCPMessageContent, BCPNotifyPlayer, SendAction, SendBCPMessage } from "@/utils/Messaging";
import { decodeExport, encodeExport } from "@/utils/ExportImport";
import { jsonClone } from "@/utils/BCUtils";
import { ConditionData, conditionsExpired, conditionsMet, sanitizeConditions } from "@/system/conditions/Conditions";
import { sanitizePunishConfig } from "@/system/punishments/PunishmentTypes";
import { debug, warn } from "@/system/Console";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";
import type { Originator } from "@/system/module/ModuleTypes";
import type Roles from "@/modules/Roles";
import type Core from "@/modules/Core";
import type Authority from "@/modules/Authority";
import type DataSync from "@/modules/DataSync";
import type Logging from "@/modules/Logging";
import type Contracts from "@/modules/Contracts";
import type Punishments from "@/modules/Punishments";
import type Welding from "@/modules/Welding";

export default class Rules extends ModuleInstance {

    private readonly registry = new Map<string, RuleDefinition>();
    private readonly installed = new Set<string>();
    private timerCheck: ReturnType<typeof setInterval> | null = null;
    /** Intervals owned by installed rules, cleared on uninstall. */
    private readonly ruleTimers = new Map<string, ReturnType<typeof setInterval>[]>();
    /** Cleanup callbacks registered by installed rules, run on uninstall. */
    private readonly ruleCleanups = new Map<string, (() => void)[]>();
    /** Cached BCX rule state handles (stable objects; their fields are live). */
    private readonly bcxRuleStates = new Map<string, BCX_RuleStateAPI | null>();

    protected readonly SystemConfig: ModuleConfig = {
        Name: "Rules",
        Version: BCPLUS_VERSION,
        Author: BCPLUS_AUTHOR,
        Description: "Restrictions on the player's behavior",
        Active: true,
        Icon: "Icons/Rules.png",
        HoverText: "Rules restrict what you can do in the club. Each rule can be enforced "
            + "(the action is blocked) and/or logged (violations are recorded).",
        PublicData: true,
        Reference: "rules",
        MenuString: "Rules",
    };

    override get Permissions(): PermissionDefinition[] {
        return [{
            id: "rules.edit",
            label: "Change my rules",
            defaultRole: Role.Mistress,
            defaultSelf: true,
        }];
    }

    override get Defaults(): Record<string, unknown> {
        return { rules: {}, ruleOrder: [], ruleSort: "category", globalConditions: {} };
    }

    /** The shared conditions set that rules with `useGlobal` follow. Never has a timer. */
    get GlobalConditions(): ConditionData {
        const raw = this.Data.globalConditions;
        return (typeof raw === "object" && raw !== null ? raw : {}) as ConditionData;
    }

    /** Sets the global conditions (sanitized; timers are stripped - a shared timer expiring everything at once would surprise). */
    setGlobalConditions(raw: unknown): boolean {
        const sanitized = sanitizeConditions(raw);
        if (sanitized === null) {
            return false;
        }
        delete sanitized.timerEnd;
        delete sanitized.timerAction;
        this.Data.globalConditions = sanitized;
        return true;
    }

    setRuleUseGlobal(id: string, value: boolean): void {
        if (this.isRuleWeldLocked(id) || this.isRuleContractBound(id)) {
            return;
        }
        this.ruleState(id).useGlobal = value;
    }

    /** The conditions that actually gate this rule: its own, or the shared global set. */
    effectiveConditions(id: string): ConditionData | undefined {
        const state = this.ruleState(id);
        return state.useGlobal === true ? this.GlobalConditions : state.conditions;
    }

    /** Custom display order for the rules list (rule ids; may include inactive ones). */
    get RuleOrder(): string[] {
        const raw = this.Data.ruleOrder;
        return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
    }

    get SortMode(): "custom" | "category" {
        return this.Data.ruleSort === "custom" ? "custom" : "category";
    }

    setSortMode(mode: "custom" | "category"): void {
        this.Data.ruleSort = mode;
    }

    /**
     * Moves a rule one step in the custom display order. `displayed` is the
     * id list as currently shown - it becomes the stored order, so the first
     * move behaves exactly as seen on screen.
     */
    moveRuleInOrder(id: string, delta: -1 | 1, displayed: string[]): void {
        const order = [...displayed];
        const from = order.indexOf(id);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= order.length) {
            return;
        }
        order[from] = order[to]!;
        order[to] = id;
        this.Data.ruleOrder = order;
    }

    override get HasGUI(): boolean {
        return true;
    }

    override get SupportsRemote(): boolean {
        return true;
    }

    override get SettingsScreen(): ((character: BCPlusCharacter | null) => GUIScreen) | null {
        return (character) => new RulesListScreen(this, character);
    }

    get Definitions(): RuleDefinition[] {
        return [...this.registry.values()];
    }

    getDefinition(id: string): RuleDefinition | undefined {
        return this.registry.get(id);
    }

    /** The rule's persisted state, created from defaults on first access. */
    ruleState(id: string): RuleStateData {
        const definition = this.registry.get(id);
        if (!definition) {
            throw new Error(`Unknown rule: ${id}`);
        }
        const store = this.Data.rules as Record<string, RuleStateData>;
        if (store[id] === undefined) {
            store[id] = defaultRuleState(definition);
        } else {
            // New settings/fields added by updates get their defaults merged in
            store[id].announce ??= true;
            const defaults = defaultRuleState(definition).settings;
            for (const [key, value] of Object.entries(defaults)) {
                if (!(key in store[id].settings)) {
                    store[id].settings[key] = value;
                }
            }
        }
        return store[id];
    }

    /**
     * Whether a welded collar locks this rule: it is then forced active,
     * enforced and unconditional, and nobody may change that - the weld
     * dissolving (owner release) is the only unlock.
     */
    isRuleWeldLocked(id: string): boolean {
        return this.ModuleManager.getModule<Welding>("welding")?.lockedRuleIds().includes(id) ?? false;
    }

    /** Whether the player may change rule states locally. */
    canEdit(): boolean {
        const authority = this.ModuleManager.getModule<Authority>("authority");
        return authority?.hasPermission(Player.MemberNumber ?? -1, "rules.edit") ?? false;
    }

    /** Shareable code containing every rule's state and settings. */
    exportCode(): string {
        return encodeExport("rules", jsonClone(this.Data.rules));
    }

    /** Applies a rules code; returns how many rules were imported. */
    importCode(code: string): number {
        const payload = decodeExport(code, "rules");
        if (typeof payload !== "object" || payload === null) {
            return 0;
        }
        let applied = 0;
        for (const [id, raw] of Object.entries(payload as Record<string, unknown>)) {
            if (!this.registry.has(id) || typeof raw !== "object" || raw === null) {
                continue;
            }
            const state = raw as Partial<RuleStateData>;
            if (typeof state.enforce === "boolean") {
                this.setRuleEnforce(id, state.enforce);
            }
            if (typeof state.log === "boolean") {
                this.setRuleLog(id, state.log);
            }
            if (typeof state.announce === "boolean") {
                this.setRuleAnnounce(id, state.announce);
            }
            if (typeof state.useGlobal === "boolean") {
                this.setRuleUseGlobal(id, state.useGlobal);
            }
            if (state.punish !== undefined) {
                // Referenced punishment ids may not exist here; unknown ids are
                // simply never applied
                this.setRulePunish(id, state.punish);
            }
            if (typeof state.settings === "object" && state.settings !== null) {
                for (const [name, value] of Object.entries(state.settings)) {
                    this.setRuleSetting(id, name, value);
                }
            }
            this.setRuleActive(id, state.active === true);
            applied++;
        }
        // A welded collar survives any import: its rules snap back on
        this.ModuleManager.getModule<Welding>("welding")?.enforceWeldLocks();
        return applied;
    }

    /** Whether an active punishment currently forces this rule on. */
    isRulePunishmentForced(id: string): boolean {
        return this.ModuleManager.getModule<Punishments>("punishments")?.isRuleForced(id) === true;
    }

    /** Whether a signed contract currently binds this rule. */
    isRuleContractBound(id: string): boolean {
        return this.ModuleManager.getModule<Contracts>("contracts")?.isRuleContractBound(id) === true;
    }

    /** Sets the punishments attached to a rule; an empty list clears the attachment. */
    setRulePunish(id: string, raw: unknown): boolean {
        if (!this.registry.has(id)) {
            return false;
        }
        const sanitized = sanitizePunishConfig(raw);
        if (sanitized === null) {
            return false;
        }
        if (sanitized.punishments.length === 0) {
            delete this.ruleState(id).punish;
        } else {
            this.ruleState(id).punish = sanitized;
        }
        return true;
    }

    setRuleActive(id: string, active: boolean, by?: Originator): void {
        if (active && this.Preset === "Dominant") {
            BCPNotifyPlayer("Your Dominant preset does not accept rules.");
            return;
        }
        if (!active && this.isRuleWeldLocked(id)) {
            BCPNotifyPlayer("This rule is locked by the welded collar and cannot be deactivated.");
            return;
        }
        if (!active && this.isRulePunishmentForced(id)) {
            BCPNotifyPlayer(`The rule "${this.registry.get(id)?.name ?? id}" is enforced as a punishment right now and cannot be deactivated.`);
            return;
        }
        if (!active && this.isRuleContractBound(id)) {
            BCPNotifyPlayer(`The rule "${this.registry.get(id)?.name ?? id}" is bound by a signed contract and cannot be deactivated until the contract ends.`);
            return;
        }
        const state = this.ruleState(id);
        if (state.active === active) {
            return;
        }
        state.active = active;
        if (active) {
            state.addedBy = by ?? { member: Player.MemberNumber ?? -1, name: Player.Nickname || Player.Name };
            if (!this.RuleOrder.includes(id)) {
                this.Data.ruleOrder = [...this.RuleOrder, id];
            }
            this.installRule(id);
        } else {
            delete state.addedBy;
            this.uninstallRule(id);
        }
        this.Events.emit("ruleChanged", { rule: id, active });
    }

    /** Re-applies the preset: Dominant uninstalls everything, others restore active rules. */
    applyPreset(): void {
        if (this.Preset === "Dominant") {
            for (const id of [...this.installed]) {
                this.uninstallRule(id);
            }
        } else {
            for (const id of this.registry.keys()) {
                if (this.ruleState(id).active) {
                    this.installRule(id);
                }
            }
        }
    }

    setRuleEnforce(id: string, value: boolean): void {
        if (!value && (this.isRuleWeldLocked(id) || this.isRulePunishmentForced(id) || this.isRuleContractBound(id))) {
            return;
        }
        this.ruleState(id).enforce = value;
    }

    setRuleLog(id: string, value: boolean): void {
        this.ruleState(id).log = value;
    }

    setRuleAnnounce(id: string, value: boolean): void {
        this.ruleState(id).announce = value;
    }

    /** Sets a rule's conditions (sanitized); pass null/{} to clear. */
    setRuleConditions(id: string, raw: unknown): boolean {
        if (!this.registry.has(id) || this.isRuleWeldLocked(id) || this.isRuleContractBound(id)) {
            return false;
        }
        const sanitized = sanitizeConditions(raw);
        if (sanitized === null) {
            return false;
        }
        if (Object.keys(sanitized).length === 0) {
            delete this.ruleState(id).conditions;
        } else {
            this.ruleState(id).conditions = sanitized;
        }
        return true;
    }

    /** Whether the rule currently applies (active + conditions met). */
    ruleInEffect(id: string): boolean {
        // A punishment-forced rule is unconditional: conditions and BCX
        // deferral are ignored for the punishment's duration
        if (this.isRulePunishmentForced(id)) {
            return true;
        }
        const state = this.ruleState(id);
        // Weld-locked rules apply unconditionally: no conditions, no BCX
        // deferral - the lock must not be escapable through either
        if (this.isRuleWeldLocked(id)) {
            return state.active;
        }
        return state.active
            && !this.ruleDeferredToBCX(id)
            && conditionsMet(this.effectiveConditions(id), this.ModuleManager.getModule<Roles>("roles"));
    }

    /**
     * True when tandem mode hands this rule over to BCX: the rule maps to a
     * BCX equivalent that is currently in effect, and deferring is enabled.
     * BCX toggling its rule immediately un-pauses ours - the query is live.
     */
    ruleDeferredToBCX(id: string): boolean {
        const definition = this.registry.get(id);
        if (!definition?.bcxEquivalent || !this.SDK.bcxInstalled()) {
            return false;
        }
        const core = this.ModuleManager.getModule<Core>("core");
        if (core?.getSetting<boolean>("tandemDefer") === false) {
            return false;
        }
        let state = this.bcxRuleStates.get(definition.bcxEquivalent);
        if (state === undefined) {
            try {
                state = this.SDK.bcxAPI()?.getRuleState(definition.bcxEquivalent) ?? null;
            } catch {
                state = null;
            }
            this.bcxRuleStates.set(definition.bcxEquivalent, state);
        }
        try {
            return state?.inEffect === true;
        } catch {
            return false;
        }
    }

    /** Sets a rule's custom setting; the value must match the setting's declared type. */
    setRuleSetting(id: string, name: string, value: unknown): boolean {
        const definition = this.registry.get(id);
        const setting = definition?.settings?.find((s) => s.name === name);
        if (!setting || this.isRuleContractBound(id)) {
            return false;
        }
        // Legacy string shapes stay accepted for members/stringList: older
        // clients (and old saves) still hold/send the comma-string form
        const valid = (setting.type === "checkbox" && typeof value === "boolean")
            || (setting.type === "option" && typeof value === "string" && setting.options.includes(value))
            || (setting.type === "text" && typeof value === "string" && value.length <= (setting.maxChars ?? 256))
            || (setting.type === "members" && (
                (Array.isArray(value) && value.length <= 100
                    && value.every((m) => typeof m === "number" && Number.isInteger(m) && m >= 0))
                || (typeof value === "string" && value.length <= 500)))
            || (setting.type === "stringList" && (
                (Array.isArray(value) && value.length <= (setting.maxEntries ?? 50)
                    && value.every((s) => typeof s === "string" && s.length <= (setting.maxChars ?? 200)))
                || (typeof value === "string" && value.length <= 1000)));
        if (!valid) {
            return false;
        }
        this.ruleState(id).settings[name] = value;
        return true;
    }

    override Init(): Promise<void> {
        for (const definition of RULE_DEFINITIONS) {
            if (this.registry.has(definition.id)) {
                warn(`Duplicate rule id ${definition.id}, skipping`);
                continue;
            }
            this.registry.set(definition.id, definition);
        }
        return Promise.resolve();
    }

    override get CanDisable(): boolean {
        return true;
    }

    override Load(): void {
        if (this.Preset !== "Dominant") {
            for (const id of this.registry.keys()) {
                if (this.ruleState(id).active) {
                    this.installRule(id);
                }
            }
        }

        // Timer expiry: an expired rule deactivates itself
        this.timerCheck = setInterval(() => {
            for (const id of this.registry.keys()) {
                const state = this.ruleState(id);
                // Rules following the global set have no live timer (it is
                // stripped from global conditions); a stale timer in their
                // dormant custom conditions must not expire them
                if (state.useGlobal === true || this.isRuleWeldLocked(id)
                    || this.isRulePunishmentForced(id) || this.isRuleContractBound(id)) {
                    continue;
                }
                if (state.active && conditionsExpired(state.conditions)) {
                    const name = this.registry.get(id)!.name;
                    if (state.conditions?.timerAction === "remove") {
                        delete state.conditions;
                    } else if (state.conditions) {
                        delete state.conditions.timerEnd;
                        delete state.conditions.timerAction;
                    }
                    this.setRuleActive(id, false);
                    BCPNotifyPlayer(`The rule "${name}" has expired.`);
                }
            }
        }, 5000);

        // Incoming remote edits: validate permission and value here - the
        // requester's UI is never trusted.
        this.addSyncListener("RuleCommand", (sender, content) => this.onRuleCommand(sender, content));
        this.addSyncListener("RuleCommandResult", (sender, content) => {
            if (content.ok === false) {
                BCPNotifyPlayer(`${sender.Name} rejected the rule change${typeof content.reason === "string" ? `: ${content.reason}` : "."}`);
                // Our optimistic mirror is wrong - ask for a fresh sync
                this.ModuleManager.getModule<DataSync>("data-sync")?.settingSync(true, sender.MemberNumber);
            }
        });
    }

    override Unload(): void {
        if (this.timerCheck !== null) {
            clearInterval(this.timerCheck);
            this.timerCheck = null;
        }
        for (const id of [...this.installed]) {
            this.uninstallRule(id);
        }
        super.Unload();
    }

    private hookOwner(id: string): string {
        return `rules:${id}`;
    }

    private installRule(id: string): void {
        if (this.installed.has(id)) {
            return;
        }
        const definition = this.registry.get(id)!;
        try {
            definition.load(this.buildContext(definition));
            this.installed.add(id);
            debug(`Rule installed: ${id}`);
        } catch (e) {
            warn(`Failed to install rule ${id}:`, e);
            this.SDK.removeHooks(this.hookOwner(id));
        }
    }

    private uninstallRule(id: string): void {
        this.SDK.removeHooks(this.hookOwner(id));
        for (const timer of this.ruleTimers.get(id) ?? []) {
            clearInterval(timer);
        }
        this.ruleTimers.delete(id);
        for (const cleanup of this.ruleCleanups.get(id) ?? []) {
            try {
                cleanup();
            } catch (e) {
                warn(`Rule ${id} cleanup failed:`, e);
            }
        }
        this.ruleCleanups.delete(id);
        this.installed.delete(id);
        debug(`Rule uninstalled: ${id}`);
    }

    private buildContext(definition: RuleDefinition): RuleContext {
        const state = (): RuleStateData => this.ruleState(definition.id);
        return {
            hook: (functionName, priority, hook) => {
                this.SDK.addHook(this.hookOwner(definition.id), functionName, priority, hook);
            },
            setting: <T>(name: string): T => state().settings[name] as T,
            interval: (callback: () => void, ms: number) => {
                const timer = setInterval(callback, ms);
                const timers = this.ruleTimers.get(definition.id) ?? [];
                timers.push(timer);
                this.ruleTimers.set(definition.id, timers);
            },
            cleanup: (callback: () => void) => {
                const cleanups = this.ruleCleanups.get(definition.id) ?? [];
                cleanups.push(callback);
                this.ruleCleanups.set(definition.id, cleanups);
            },
            inEffect: () => this.ruleInEffect(definition.id),
            isEnforced: () => state().enforce && this.ruleInEffect(definition.id),
            isLogged: () => state().log && this.ruleInEffect(definition.id),
            trigger: (target?: number | null) => {
                if (!this.ruleInEffect(definition.id)) {
                    return;
                }
                this.reportTrigger(definition.id, "trigger", target ?? null);
                this.announceBreach(definition, "trigger");
            },
            triggerAttempt: (target?: number | null) => {
                if (!this.ruleInEffect(definition.id)) {
                    return;
                }
                this.reportTrigger(definition.id, "triggerAttempt", target ?? null);
                this.announceBreach(definition, "triggerAttempt");
            },
            notify: (message: string) => BCPNotifyPlayer(message),
            highestRoleOf: (memberNumber: number) => {
                const roles = this.ModuleManager.getModule<Roles>("roles");
                return roles?.highestRole(memberNumber) ?? Role.Public;
            },
        };
    }

    private reportTrigger(rule: string, type: "trigger" | "triggerAttempt", target: number | null): void {
        debug(`Rule ${type}: ${rule}`, target === null ? "" : `target #${target}`);
        this.Events.emit("ruleTriggered", { rule, type, target });
    }

    /** Announces a breach to the room as an action message, when the rule wants it. */
    private announceBreach(definition: RuleDefinition, type: "trigger" | "triggerAttempt"): void {
        if (!this.ruleState(definition.id).announce || !ServerPlayerIsInChatRoom()) {
            return;
        }
        const template = type === "triggerAttempt"
            ? definition.announceAttempt
            : (definition.announceViolation ?? definition.announceAttempt);
        if (!template) {
            return;
        }
        SendAction(template.replace(/\{Name\}/g, Player.Nickname || Player.Name));
    }

    private onRuleCommand(sender: Character, content: BCPMessageContent): void {
        const senderNumber = sender.MemberNumber;
        if (typeof senderNumber !== "number") {
            return;
        }
        const reject = (reason: string): void => {
            SendBCPMessage({ message: "RuleCommandResult", ok: false, rule: content.rule, reason }, senderNumber);
        };

        const { action, rule, name, value } = content;
        const authority = this.ModuleManager.getModule<Authority>("authority");

        // Global conditions affect every following rule, so a rule-scoped
        // grant is not enough - the scope below only matches full grants
        if (action === "setGlobalConditions") {
            if (!authority?.hasPermission(senderNumber, "rules.edit", "_global_")) {
                reject("no permission for the global conditions");
                return;
            }
            if (this.Preset === "Dominant") {
                reject("their Dominant preset does not accept rules");
                return;
            }
            if (!this.setGlobalConditions(value ?? {})) {
                reject("invalid command");
                return;
            }
            BCPNotifyPlayer(`${sender.Name} (#${senderNumber}) changed your global rule conditions.`);
            this.ModuleManager.getModule<Logging>("logging")
                ?.log("rule", `${sender.Name} (#${senderNumber}) changed the global rule conditions`);
            SendBCPMessage({ message: "RuleCommandResult", ok: true, rule }, senderNumber);
            this.ModuleManager.getModule<DataSync>("data-sync")?.categorySync(this, senderNumber);
            return;
        }

        if (typeof rule !== "string" || !this.registry.has(rule)) {
            reject("unknown rule");
            return;
        }
        if (!authority?.hasPermission(senderNumber, "rules.edit", rule)) {
            reject("no permission for this rule");
            return;
        }
        if (this.Preset === "Dominant") {
            reject("their Dominant preset does not accept rules");
            return;
        }
        // Log/announce stay adjustable; everything that could weaken the
        // rule is sealed while the collar is welded
        if (this.isRuleWeldLocked(rule) && action !== "setLog" && action !== "setAnnounce") {
            reject("this rule is locked by a welded collar");
            return;
        }
        if (this.isRulePunishmentForced(rule) && value === false
            && (action === "setActive" || action === "setEnforce")) {
            reject("this rule is currently enforced as a punishment");
            return;
        }
        // Contract-bound rules are sealed for everyone until the contract
        // ends - the author amends by releasing and re-offering
        if (this.isRuleContractBound(rule) && action !== "setLog" && action !== "setAnnounce") {
            reject("this rule is bound by a signed contract");
            return;
        }

        let applied = false;
        let verb = "changed";
        if (action === "setActive" && typeof value === "boolean") {
            this.setRuleActive(rule, value, { member: senderNumber, name: sender.Name });
            verb = value ? "activated" : "deactivated";
            applied = true;
        } else if (action === "setEnforce" && typeof value === "boolean") {
            this.setRuleEnforce(rule, value);
            verb = value ? "started enforcing" : "stopped enforcing";
            applied = true;
        } else if (action === "setLog" && typeof value === "boolean") {
            this.setRuleLog(rule, value);
            verb = value ? "enabled logging for" : "disabled logging for";
            applied = true;
        } else if (action === "setAnnounce" && typeof value === "boolean") {
            this.setRuleAnnounce(rule, value);
            verb = value ? "enabled breach announcements for" : "disabled breach announcements for";
            applied = true;
        } else if (action === "setSetting" && typeof name === "string") {
            applied = this.setRuleSetting(rule, name, value);
            verb = "changed the settings of";
        } else if (action === "setConditions") {
            applied = this.setRuleConditions(rule, value ?? {});
            verb = "changed the conditions of";
        } else if (action === "setUseGlobal" && typeof value === "boolean") {
            this.setRuleUseGlobal(rule, value);
            verb = value ? "set to the global conditions" : "gave own conditions to";
            applied = true;
        } else if (action === "setPunish") {
            applied = this.setRulePunish(rule, value ?? { punishments: [] });
            verb = "changed the punishments of";
        }

        if (!applied) {
            reject("invalid command");
            return;
        }

        const definition = this.registry.get(rule)!;
        BCPNotifyPlayer(`${sender.Name} (#${senderNumber}) ${verb} your rule "${definition.name}".`);
        this.ModuleManager.getModule<Logging>("logging")
            ?.log("rule", `${sender.Name} (#${senderNumber}) ${verb} rule "${definition.name}"`);
        SendBCPMessage({ message: "RuleCommandResult", ok: true, rule }, senderNumber);
        this.ModuleManager.getModule<DataSync>("data-sync")?.categorySync(this, senderNumber);
    }
}
