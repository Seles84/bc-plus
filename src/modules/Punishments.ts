import menuIcon from "@/assets/icons/punishments.png";
import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig, PermissionDefinition } from "@/system/module/ModuleTypes";
import { BCPLUS_AUTHOR, BCPLUS_VERSION } from "@/system/Constants";
import { Role } from "@/system/Roles";
import { captureItemSpec } from "@/system/curses/CurseTypes";
import {
    ActivePunishment, PUNISHMENT_LOCKS, PunishmentDefinition, describeDuration,
} from "@/system/punishments/PunishmentTypes";
import { BCPMessageContent, BCPNotifyPlayer, SafeReasonSuffix, SendAction, SendBCPMessage } from "@/utils/Messaging";
import { jsonClone } from "@/utils/BCUtils";
import { debug, err, warn } from "@/system/Console";
import type { Originator } from "@/system/module/ModuleTypes";
import type Authority from "@/modules/Authority";
import type Curses from "@/modules/Curses";
import type DataSync from "@/modules/DataSync";
import type Logging from "@/modules/Logging";
import type Rules from "@/modules/Rules";
import type Core from "@/modules/Core";

const TICK_MS = 1500;
/** Minimum time between re-applications of the same punishment (fight-loop guard). */
const RESTORE_COOLDOWN_MS = 1200;
/** Minimum time between "reasserted" notifications per punishment. */
const NOTIFY_COOLDOWN_MS = 10_000;
/** Consecutive non-converging restores before enforcement pauses for a while. */
const MAX_CONSECUTIVE_RESTORES = 4;
const SUSPEND_MS = 60_000;
/** How long a cursed slot is asked to yield while an item punishment owns it. */
const CURSE_YIELD_MS = 10_000;

/** Cap on stored definitions - each lives in the auto-synced save, and the remote create paths must not grow it unboundedly. */
const MAX_DEFINITIONS = 24;

/** Message fragments gathered across one trigger's punishments, so the caller sends one combined notify/announcement. */
interface AnnounceCollector {
    player: string[];
    room: string[];
}

/**
 * Automatic punishments: definitions of what can happen when a rule is
 * broken (an item forced on, or another rule forced active for a while),
 * applied when a rule with punishments attached reaches its violation
 * threshold. SECURITY INVARIANT: everything validates on this client -
 * remote commands are never trusted.
 */
export default class Punishments extends ModuleInstance {

    private tickTimer: ReturnType<typeof setInterval> | null = null;
    /** Violation timestamps per rule for threshold counting (session-local). */
    private readonly violations = new Map<string, number[]>();
    private readonly lastRestore = new Map<string, number>();
    private readonly lastNotify = new Map<string, number>();
    private readonly consecutiveRestores = new Map<string, number>();
    private readonly suspendedUntil = new Map<string, number>();
    /** EventBus unsubscribers, cleared on Unload. */
    private readonly eventUnsubs: (() => void)[] = [];

    protected readonly SystemConfig: ModuleConfig = {
        Name: "Punishments",
        Version: BCPLUS_VERSION,
        Author: BCPLUS_AUTHOR,
        Description: "Automatic punishments for broken rules",
        Active: true,
        Icon: menuIcon,
        HoverText: "Punishments are applied automatically when rules with punishments "
            + "attached are broken: an item is forced on (and comes back if removed), or "
            + "another rule is forced active for a while. Define punishments here, then "
            + "attach them on a rule's config page.",
        PublicData: true,
        Reference: "punishments",
        MenuString: "Punishments",
    };

    override get Permissions(): PermissionDefinition[] {
        return [
            {
                id: "punishments.edit",
                label: "Change my punishments",
                defaultRole: Role.Mistress,
                defaultSelf: true,
            },
            {
                id: "punishments.lift",
                label: "Lift my running punishments",
                defaultRole: Role.Mistress,
                defaultSelf: false,
            },
        ];
    }

    override get Defaults(): Record<string, unknown> {
        return { punishments: {}, active: {} };
    }

    override get HasGUI(): boolean {
        return true;
    }

    override get SupportsRemote(): boolean {
        return true;
    }

    override get CanDisable(): boolean {
        return true;
    }

    get Definitions(): Record<string, PunishmentDefinition> {
        return this.Data.punishments as Record<string, PunishmentDefinition>;
    }

    get Active(): Record<string, ActivePunishment> {
        return this.Data.active as Record<string, ActivePunishment>;
    }

    canEdit(): boolean {
        const authority = this.ModuleManager.getModule<Authority>("authority");
        return authority?.hasPermission(Player.MemberNumber ?? -1, "punishments.edit") ?? false;
    }

    canLift(): boolean {
        const authority = this.ModuleManager.getModule<Authority>("authority");
        return authority?.hasPermission(Player.MemberNumber ?? -1, "punishments.lift") ?? false;
    }

    /** Whether an active rule-kind punishment currently forces this rule. */
    isRuleForced(ruleId: string): boolean {
        return Object.values(this.Active).some((a) => a.forcedRule === ruleId);
    }

    private generateId(): string {
        let id: string;
        do {
            id = `p${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
        } while (this.Definitions[id]);
        return id;
    }

    private atDefinitionCap(): boolean {
        return Object.keys(this.Definitions).length >= MAX_DEFINITIONS;
    }

    /** Creates an item punishment from the item currently worn in the group. */
    createFromWorn(group: AssetGroupName, by?: Originator): PunishmentDefinition | null {
        const worn = InventoryGet(Player, group);
        if (!worn || this.atDefinitionCap()) {
            return null;
        }
        const definition: PunishmentDefinition = {
            id: this.generateId(),
            name: worn.Craft?.Name || worn.Asset.Description,
            kind: "item",
            durationMin: 10,
            announce: true,
            group,
            item: captureItemSpec(worn, true),
            lock: "",
            addedBy: by ?? { member: Player.MemberNumber ?? -1, name: Player.Nickname || Player.Name },
        };
        this.Definitions[definition.id] = definition;
        return definition;
    }

    /**
     * Creates an item punishment from a catalog pick. The spec is loose by
     * nature (there is no worn state to capture): any color/type of the asset
     * satisfies enforcement, which re-applies at asset level anyway.
     */
    createFromCatalog(group: AssetGroupName, assetName: string, by?: Originator): PunishmentDefinition | null {
        const asset = AssetGet(Player.AssetFamily, group, assetName);
        if (!asset || !asset.Wear || asset.IsLock || this.atDefinitionCap()) {
            return null;
        }
        const definition: PunishmentDefinition = {
            id: this.generateId(),
            name: asset.Description.slice(0, 40),
            kind: "item",
            durationMin: 10,
            announce: true,
            group,
            item: { asset: asset.Name, name: asset.Description, strict: false },
            lock: "",
            addedBy: by ?? { member: Player.MemberNumber ?? -1, name: Player.Nickname || Player.Name },
        };
        this.Definitions[definition.id] = definition;
        return definition;
    }

    /** Creates a punishment that forces another rule for the duration. */
    createRulePunishment(ruleId: string, by?: Originator): PunishmentDefinition | null {
        const rules = this.ModuleManager.getModule<Rules>("rules");
        const ruleDefinition = rules?.getDefinition(ruleId);
        if (!ruleDefinition || this.atDefinitionCap()) {
            return null;
        }
        const definition: PunishmentDefinition = {
            id: this.generateId(),
            name: `Rule: ${ruleDefinition.name}`,
            kind: "rule",
            durationMin: 30,
            announce: true,
            rule: ruleId,
            addedBy: by ?? { member: Player.MemberNumber ?? -1, name: Player.Nickname || Player.Name },
        };
        this.Definitions[definition.id] = definition;
        return definition;
    }

    /** Deletes a definition; running punishments continue (they are snapshots). */
    removeDefinition(id: string): void {
        if (!this.Definitions[id]) {
            return;
        }
        delete this.Definitions[id];
        // Strip the id from every rule attachment so lists stay clean
        const rules = this.ModuleManager.getModule<Rules>("rules");
        for (const definition of rules?.Definitions ?? []) {
            const punish = rules!.ruleState(definition.id).punish;
            if (punish?.punishments.includes(id)) {
                rules!.setRulePunish(definition.id, {
                    ...punish,
                    punishments: punish.punishments.filter((p) => p !== id),
                });
            }
        }
    }

    setName(id: string, name: string): boolean {
        const definition = this.Definitions[id];
        const trimmed = name.trim().slice(0, 40);
        if (!definition || trimmed.length === 0) {
            return false;
        }
        definition.name = trimmed;
        return true;
    }

    setDuration(id: string, minutes: number): boolean {
        const definition = this.Definitions[id];
        if (!definition || !Number.isInteger(minutes) || minutes < 0 || minutes > 4320) {
            return false;
        }
        definition.durationMin = minutes;
        return true;
    }

    setLock(id: string, lock: string): boolean {
        const definition = this.Definitions[id];
        if (!definition || definition.kind !== "item" || !PUNISHMENT_LOCKS.some((l) => l.asset === lock)) {
            return false;
        }
        definition.lock = lock;
        return true;
    }

    setAnnounce(id: string, value: boolean): boolean {
        const definition = this.Definitions[id];
        if (!definition) {
            return false;
        }
        definition.announce = value;
        return true;
    }

    /**
     * Called on every rule trigger; counts violations against the rule's
     * punish config and applies its punishments when the threshold is hit.
     */
    private onRuleTriggered(rule: string): void {
        if (!this.Config.Active || this.Preset === "Dominant") {
            return;
        }
        const rules = this.ModuleManager.getModule<Rules>("rules");
        if (!rules?.getDefinition(rule)) {
            return;
        }
        const punish = rules.ruleState(rule).punish;
        if (!punish || punish.punishments.length === 0) {
            return;
        }
        const now = Date.now();
        const windowStart = now - punish.windowMin * 60_000;
        const times = (this.violations.get(rule) ?? []).filter((t) => t >= windowStart);
        times.push(now);
        if (times.length < punish.threshold) {
            this.violations.set(rule, times);
            return;
        }
        this.violations.set(rule, []);
        // A rule with several punishments attached announces once, listing
        // them all - one chat line per punishment was spam
        const collect: AnnounceCollector = { player: [], room: [] };
        for (const id of punish.punishments) {
            try {
                this.applyPunishment(id, rule, punish.repeat, undefined, collect);
            } catch (e) {
                err(`Failed to apply punishment ${id}:`, e);
            }
        }
        const ruleName = rules.getDefinition(rule)?.name ?? rule;
        if (collect.player.length > 0) {
            BCPNotifyPlayer(`You are being punished for breaking "${ruleName}": ${collect.player.join("; ")}.`);
        }
        if (collect.room.length > 0 && ServerPlayerIsInChatRoom()) {
            const name = Player.Nickname || Player.Name;
            SendAction(`${name} broke the rule "${ruleName}" and is being punished: ${collect.room.join(", ")}.`);
        }
    }

    /**
     * Starts (or per repeat policy extends) a punishment. `sourceRule` is the
     * violated rule id, or "manual" when someone applies it directly. With
     * `collect`, message fragments are gathered there instead of notifying and
     * announcing per punishment (the caller sends one combined message).
     */
    applyPunishment(id: string, sourceRule: string, repeat: "restart" | "stack" | "ignore" = "stack", byName?: string, collect?: AnnounceCollector): boolean {
        const definition = this.Definitions[id];
        if (!definition || this.Preset === "Dominant") {
            return false;
        }
        const rules = this.ModuleManager.getModule<Rules>("rules");
        const ruleName = rules?.getDefinition(sourceRule)?.name;
        const existing = this.Active[id];

        if (existing) {
            if (repeat === "ignore" || existing.until === null) {
                return false;
            }
            const extension = definition.durationMin * 60_000;
            if (extension <= 0) {
                return false;
            }
            existing.until = repeat === "restart"
                ? Date.now() + extension
                : existing.until + extension;
            existing.sourceRule = sourceRule;
            if (collect) {
                collect.player.push(repeat === "restart"
                    ? `"${definition.name}" restarted at ${describeDuration(definition.durationMin)}`
                    : `"${definition.name}" extended by ${describeDuration(definition.durationMin)}`);
            } else {
                BCPNotifyPlayer(repeat === "restart"
                    ? `Your punishment "${definition.name}" restarted at ${describeDuration(definition.durationMin)}.`
                    : `Your punishment "${definition.name}" was extended by ${describeDuration(definition.durationMin)}.`);
            }
            this.log(`Punishment "${definition.name}" ${repeat === "restart" ? "restarted" : "extended"}`
                + `${ruleName ? ` for breaking "${ruleName}"` : ""}`);
            return true;
        }

        const active: ActivePunishment = {
            punishment: id,
            name: definition.name,
            kind: definition.kind,
            sourceRule,
            startedAt: Date.now(),
            until: definition.durationMin > 0 ? Date.now() + definition.durationMin * 60_000 : null,
            announce: definition.announce,
        };

        if (definition.kind === "item") {
            if (!definition.group || !definition.item) {
                return false;
            }
            active.group = definition.group;
            active.item = jsonClone(definition.item);
            active.lock = definition.lock;
        } else {
            if (!definition.rule || !rules?.getDefinition(definition.rule)) {
                return false;
            }
            const state = rules.ruleState(definition.rule);
            active.forcedRule = definition.rule;
            active.priorActive = state.active;
            active.priorEnforce = state.enforce;
            rules.setRuleActive(definition.rule, true, { member: Player.MemberNumber ?? -1, name: byName ?? "Punishment" });
            rules.setRuleEnforce(definition.rule, true);
        }

        this.Active[id] = active;
        this.Events.emit("punishmentStarted", { punishment: id });
        if (definition.kind === "item") {
            this.enforceItem(active);
        }

        const durationText = definition.durationMin > 0 ? ` for ${describeDuration(definition.durationMin)}` : " until lifted";
        this.log(`Punishment applied: "${definition.name}"${durationText}`
            + `${ruleName ? ` (broke "${ruleName}")` : byName ? ` (by ${byName})` : ""}`);
        if (collect) {
            collect.player.push(`${definition.name}${durationText}`);
            if (definition.announce) {
                collect.room.push(`${definition.name}${durationText}`);
            }
        } else {
            const cause = byName
                ? `${byName} punished you`
                : `You are being punished${ruleName ? ` for breaking "${ruleName}"` : ""}`;
            BCPNotifyPlayer(`${cause}: ${definition.name}${durationText}.`);
            if (definition.announce && ServerPlayerIsInChatRoom()) {
                const name = Player.Nickname || Player.Name;
                SendAction(ruleName
                    ? `${name} broke the rule "${ruleName}" and is being punished: ${definition.name}${durationText}.`
                    : `${name} is being punished: ${definition.name}${durationText}.`);
            }
        }
        return true;
    }

    /** Ends a punishment. Items stay worn but stop being enforced. */
    endPunishment(id: string, how: "expired" | "lifted", byName?: string): boolean {
        const active = this.Active[id];
        if (!active) {
            return false;
        }
        // Remove the entry FIRST: the rule setters below are guarded against
        // changing punishment-forced rules, and that guard checks this store
        delete this.Active[id];
        this.lastRestore.delete(id);
        this.lastNotify.delete(id);
        this.consecutiveRestores.delete(id);
        this.suspendedUntil.delete(id);

        if (active.forcedRule) {
            const rules = this.ModuleManager.getModule<Rules>("rules");
            if (rules?.getDefinition(active.forcedRule)) {
                rules.setRuleEnforce(active.forcedRule, active.priorEnforce !== false);
                rules.setRuleActive(active.forcedRule, active.priorActive === true);
            }
        }
        this.Events.emit("punishmentEnded", { punishment: id, how });

        const message = how === "lifted"
            ? `${byName ?? "Someone"} lifted your punishment "${active.name}".`
            : `Your punishment "${active.name}" is over.`;
        BCPNotifyPlayer(message);
        this.log(how === "lifted"
            ? `Punishment "${active.name}" lifted by ${byName ?? "?"}`
            : `Punishment "${active.name}" expired`);
        if (active.announce === true && ServerPlayerIsInChatRoom()) {
            const name = Player.Nickname || Player.Name;
            SendAction(how === "lifted"
                ? `${byName ?? "Someone"} has mercy and lifts ${name}'s punishment: ${active.name}.`
                : `${name}'s punishment is over: ${active.name}.`);
        }
        return true;
    }

    private log(message: string): void {
        this.ModuleManager.getModule<Logging>("logging")?.log("punishment", message);
    }

    override Load(): void {
        this.eventUnsubs.push(this.Events.on("ruleTriggered", ({ rule }) => {
            try {
                this.onRuleTriggered(rule);
            } catch (e) {
                err("Punishment trigger handling failed:", e);
            }
        }));

        this.tickTimer = setInterval(() => this.tick(), TICK_MS);

        // Remote punishment management - validated here, never trusting the requester
        this.addSyncListener("PunishmentCommand", (sender, content) => this.onPunishmentCommand(sender, content));
        this.addSyncListener("PunishmentCommandResult", (sender, content) => {
            if (content.ok === false) {
                BCPNotifyPlayer(`${sender.Name} rejected the punishment change${SafeReasonSuffix(content.reason)}`);
            }
        });
    }

    override Unload(): void {
        if (this.tickTimer !== null) {
            clearInterval(this.tickTimer);
            this.tickTimer = null;
        }
        for (const unsubscribe of this.eventUnsubs.splice(0)) {
            unsubscribe();
        }
        super.Unload();
    }

    /** Expiry and item enforcement pass. */
    private tick(): void {
        if (typeof Player === "undefined" || !Player.MemberNumber || !Array.isArray(Player.Appearance)
            || !ServerIsConnected || this.Preset === "Dominant") {
            return;
        }
        for (const [id, active] of Object.entries(this.Active)) {
            try {
                if (active.until !== null && Date.now() >= active.until) {
                    this.endPunishment(id, "expired");
                    continue;
                }
                if (active.kind === "item") {
                    this.enforceItem(active);
                }
            } catch (e) {
                debug(`Punishment tick failed for ${id}:`, e);
            }
        }
    }

    /** Keeps the punishment item on: re-applies (asset-level check) if missing. */
    private enforceItem(active: ActivePunishment): void {
        if (!active.group || !active.item) {
            return;
        }
        const id = active.punishment;
        const now = Date.now();
        if (now < (this.suspendedUntil.get(id) ?? 0)) {
            return;
        }
        // A BC+ curse on the same slot would fight the punishment - the curse
        // yields while the punishment runs and resumes afterwards
        const curses = this.ModuleManager.getModule<Curses>("curses");
        if (curses?.getSlot(active.group)?.active) {
            curses.yieldSlot(active.group, CURSE_YIELD_MS);
        }

        const worn = InventoryGet(Player, active.group);
        if (worn?.Asset.Name === active.item.asset) {
            this.consecutiveRestores.delete(id);
            return;
        }
        if (now - (this.lastRestore.get(id) ?? 0) < RESTORE_COOLDOWN_MS) {
            return;
        }
        this.lastRestore.set(id, now);

        const failures = (this.consecutiveRestores.get(id) ?? 0) + 1;
        this.consecutiveRestores.set(id, failures);
        if (failures > MAX_CONSECUTIVE_RESTORES) {
            this.suspendedUntil.set(id, now + SUSPEND_MS);
            this.consecutiveRestores.delete(id);
            err(`Punishment ${id} is not converging (something keeps rejecting the item) - pausing enforcement for ${SUSPEND_MS / 1000}s`);
            BCPNotifyPlayer(`Your punishment "${active.name}" could not hold and is resting for a minute.`);
            return;
        }

        const spec = active.item;
        const item = InventoryWear(
            Player,
            spec.asset,
            active.group,
            spec.color ?? null,
            spec.difficulty ?? null,
            Player.MemberNumber,
            spec.craft ?? null,
            true,
        );
        if (!item) {
            warn(`Punishment item ${spec.asset} could not be applied to ${active.group}`);
            return;
        }
        if (spec.property !== undefined) {
            item.Property = jsonClone(spec.property);
        }
        if (active.lock && PUNISHMENT_LOCKS.some((l) => l.asset === active.lock)) {
            try {
                InventoryLock(Player, item, active.lock as AssetLockType, Player, true);
            } catch (e) {
                debug(`Punishment lock ${active.lock} failed:`, e);
            }
        }
        CharacterRefresh(Player, false);
        if (ServerPlayerIsInChatRoom()) {
            ChatRoomCharacterUpdate(Player);
        }
        debug(`Punishment item reasserted: ${spec.asset} on ${active.group}`);
        if (now - (this.lastNotify.get(id) ?? 0) >= NOTIFY_COOLDOWN_MS) {
            this.lastNotify.set(id, now);
            BCPNotifyPlayer(`Your punishment "${active.name}" reasserted itself.`);
            if (active.announce === true && ServerPlayerIsInChatRoom()) {
                SendAction(`${Player.Nickname || Player.Name}'s punishment ${spec.name} refuses to come off.`);
            }
        }
    }

    private onPunishmentCommand(sender: Character, content: BCPMessageContent): void {
        const senderNumber = sender.MemberNumber;
        if (typeof senderNumber !== "number") {
            return;
        }
        const reject = (reason: string): void => {
            SendBCPMessage({ message: "PunishmentCommandResult", ok: false, reason }, senderNumber);
        };

        const hardcore = this.ModuleManager.getModule<Core>("core")?.hardcoreSenderBlock(senderNumber);
        if (hardcore) {
            reject(hardcore);
            return;
        }
        const { action, id, value } = content;
        const authority = this.ModuleManager.getModule<Authority>("authority");
        const needed = action === "lift" ? "punishments.lift" : "punishments.edit";
        if (!authority?.hasPermission(senderNumber, needed)) {
            reject("no permission");
            return;
        }
        if (this.Preset === "Dominant") {
            reject("their Dominant preset does not accept punishments");
            return;
        }

        const by: Originator = { member: senderNumber, name: sender.Name };
        let applied = false;
        let verb = "changed a punishment";
        if (action === "createFromWorn" && typeof value === "string") {
            applied = this.createFromWorn(value as AssetGroupName, by) !== null;
            verb = "created a punishment from your worn item";
        } else if (action === "createFromCatalog" && typeof value === "object" && value !== null) {
            const { group, asset } = value as { group?: unknown; asset?: unknown };
            if (typeof group === "string" && typeof asset === "string") {
                applied = this.createFromCatalog(group as AssetGroupName, asset, by) !== null;
                verb = "created an item punishment";
            }
        } else if (action === "createRule" && typeof value === "string") {
            applied = this.createRulePunishment(value, by) !== null;
            verb = "created a rule punishment";
        } else if (action === "remove" && typeof id === "string" && this.Definitions[id]) {
            this.removeDefinition(id);
            verb = "removed a punishment";
            applied = true;
        } else if (action === "setName" && typeof id === "string" && typeof value === "string") {
            applied = this.setName(id, value);
        } else if (action === "setDuration" && typeof id === "string" && typeof value === "number") {
            applied = this.setDuration(id, value);
        } else if (action === "setLock" && typeof id === "string" && typeof value === "string") {
            applied = this.setLock(id, value);
        } else if (action === "setAnnounce" && typeof id === "string" && typeof value === "boolean") {
            applied = this.setAnnounce(id, value);
        } else if (action === "apply" && typeof id === "string") {
            applied = this.applyPunishment(id, "manual", "stack", sender.Name);
            verb = "punished you directly";
        } else if (action === "lift" && typeof id === "string") {
            applied = this.endPunishment(id, "lifted", sender.Name);
            verb = "lifted a punishment";
        }

        if (!applied) {
            reject("invalid command");
            return;
        }

        // apply/lift produce their own notifications and log entries
        if (action !== "apply" && action !== "lift") {
            BCPNotifyPlayer(`${sender.Name} (#${senderNumber}) ${verb}.`);
            this.log(`${sender.Name} (#${senderNumber}) ${verb}`);
        }
        SendBCPMessage({ message: "PunishmentCommandResult", ok: true }, senderNumber);
        this.ModuleManager.getModule<DataSync>("data-sync")?.categorySync(this, senderNumber);
    }
}
