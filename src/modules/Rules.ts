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
import { conditionsExpired, conditionsMet, sanitizeConditions } from "@/system/conditions/Conditions";
import { debug, warn } from "@/system/Console";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";
import type Roles from "@/modules/Roles";
import type Authority from "@/modules/Authority";
import type DataSync from "@/modules/DataSync";
import type Logging from "@/modules/Logging";

export default class Rules extends ModuleInstance {

    private readonly registry = new Map<string, RuleDefinition>();
    private readonly installed = new Set<string>();
    private timerCheck: ReturnType<typeof setInterval> | null = null;

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
        return { rules: {} };
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
            if (typeof state.settings === "object" && state.settings !== null) {
                for (const [name, value] of Object.entries(state.settings)) {
                    this.setRuleSetting(id, name, value);
                }
            }
            this.setRuleActive(id, state.active === true);
            applied++;
        }
        return applied;
    }

    setRuleActive(id: string, active: boolean): void {
        if (active && this.Preset === "Dominant") {
            BCPNotifyPlayer("Your Dominant preset does not accept rules.");
            return;
        }
        const state = this.ruleState(id);
        if (state.active === active) {
            return;
        }
        state.active = active;
        if (active) {
            this.installRule(id);
        } else {
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
        if (!this.registry.has(id)) {
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
        const state = this.ruleState(id);
        return state.active && conditionsMet(state.conditions, this.ModuleManager.getModule<Roles>("roles"));
    }

    /** Sets a rule's custom setting; the value must match the setting's declared type. */
    setRuleSetting(id: string, name: string, value: unknown): boolean {
        const definition = this.registry.get(id);
        const setting = definition?.settings?.find((s) => s.name === name);
        if (!setting) {
            return false;
        }
        const valid = (setting.type === "checkbox" && typeof value === "boolean")
            || (setting.type === "option" && typeof value === "string" && setting.options.includes(value))
            || (setting.type === "text" && typeof value === "string" && value.length <= (setting.maxChars ?? 256));
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
        if (typeof rule !== "string" || !this.registry.has(rule)) {
            reject("unknown rule");
            return;
        }
        const authority = this.ModuleManager.getModule<Authority>("authority");
        if (!authority?.hasPermission(senderNumber, "rules.edit", rule)) {
            reject("no permission for this rule");
            return;
        }
        if (this.Preset === "Dominant") {
            reject("their Dominant preset does not accept rules");
            return;
        }

        let applied = false;
        let verb = "changed";
        if (action === "setActive" && typeof value === "boolean") {
            this.setRuleActive(rule, value);
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
