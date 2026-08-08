import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig, PermissionDefinition } from "@/system/module/ModuleTypes";
import { BCPLUS_AUTHOR, BCPLUS_VERSION } from "@/system/Constants";
import { Role } from "@/system/Roles";
import { RuleContext, RuleDefinition, RuleStateData, defaultRuleState } from "@/system/rules/RuleTypes";
import { RULE_DEFINITIONS } from "@/rules/index";
import { RulesListScreen } from "@/gui/RulesListScreen";
import { GUIScreen } from "@/system/gui/GUIScreen";
import { BCPNotifyPlayer } from "@/utils/Messaging";
import { debug, warn } from "@/system/Console";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";
import type Roles from "@/modules/Roles";
import type Authority from "@/modules/Authority";

export default class Rules extends ModuleInstance {

    private readonly registry = new Map<string, RuleDefinition>();
    private readonly installed = new Set<string>();

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
            // New settings added by updates get their defaults merged in
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

    setRuleActive(id: string, active: boolean): void {
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
        for (const id of this.registry.keys()) {
            if (this.ruleState(id).active) {
                this.installRule(id);
            }
        }
    }

    override Unload(): void {
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
            isEnforced: () => state().active && state().enforce,
            isLogged: () => state().active && state().log,
            trigger: (target?: number | null) => this.reportTrigger(definition.id, "trigger", target ?? null),
            triggerAttempt: (target?: number | null) => this.reportTrigger(definition.id, "triggerAttempt", target ?? null),
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
}
