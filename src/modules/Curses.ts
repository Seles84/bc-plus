import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig, PermissionDefinition } from "@/system/module/ModuleTypes";
import { BCPLUS_AUTHOR, BCPLUS_VERSION } from "@/system/Constants";
import { Role } from "@/system/Roles";
import { CurseItemSpec, CurseSlotData, adoptRestoredState, captureItemSpec, itemMatchesSpec } from "@/system/curses/CurseTypes";
import { CursesListScreen } from "@/gui/CursesScreen";
import { GUIScreen } from "@/system/gui/GUIScreen";
import { BCPMessageContent, BCPNotifyPlayer, SendAction, SendBCPMessage } from "@/utils/Messaging";
import { decodeExport, encodeExport } from "@/utils/ExportImport";
import { jsonClone } from "@/utils/BCUtils";
import { conditionsExpired, conditionsMet, sanitizeConditions } from "@/system/conditions/Conditions";
import type Roles from "@/modules/Roles";
import { debug, err } from "@/system/Console";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";
import type { Originator } from "@/system/module/ModuleTypes";
import type Authority from "@/modules/Authority";
import type Logging from "@/modules/Logging";

const TICK_MS = 1500;
/** Minimum time between restorations of the same slot, to avoid fighting loops. */
const RESTORE_COOLDOWN_MS = 1200;
/** Minimum time between "reasserted" notifications per slot - restores may repeat, chat spam must not. */
const NOTIFY_COOLDOWN_MS = 10_000;
/** Consecutive non-converging restores before a slot's enforcement pauses. */
const MAX_CONSECUTIVE_RESTORES = 4;
/** How long a non-converging slot's enforcement stays paused. */
const SUSPEND_MS = 60_000;

export default class Curses extends ModuleInstance {

    private tickTimer: ReturnType<typeof setInterval> | null = null;
    private readonly lastRestore = new Map<string, number>();
    private readonly lastNotify = new Map<string, number>();
    private lastAnnounce = 0;
    /** Item restorations collected during the current enforcement tick. */
    private tickRestores: { group: string; itemName: string }[] = [];
    /** Items removed by cursed-empty slots during the current enforcement tick. */
    private tickRemovals: { group: string; itemName: string }[] = [];
    /** Restores since the slot last checked compliant; guards against fight loops. */
    private readonly consecutiveRestores = new Map<string, number>();
    private readonly suspendedUntil = new Map<string, number>();

    protected readonly SystemConfig: ModuleConfig = {
        Name: "Curses",
        Version: BCPLUS_VERSION,
        Author: BCPLUS_AUTHOR,
        Description: "Curse item slots so only permitted items can be worn",
        Active: true,
        Icon: "Icons/Lock.png",
        HoverText: "A cursed slot only accepts its allowed items. Each allowed item has its own "
            + "rules: strict items restore their exact captured state (color, type, crafting), "
            + "loose items just have to be the same item. A slot cursed while empty stays empty.",
        PublicData: true,
        Reference: "curses",
        MenuString: "Curses",
    };

    override get Permissions(): PermissionDefinition[] {
        return [{
            id: "curses.edit",
            label: "Change my curses",
            defaultRole: Role.Mistress,
            defaultSelf: true,
        }];
    }

    override get Defaults(): Record<string, unknown> {
        return { slots: {}, announce: true };
    }

    override get HasGUI(): boolean {
        return true;
    }

    override get SupportsRemote(): boolean {
        return true;
    }

    override get SettingsScreen(): ((character: BCPlusCharacter | null) => GUIScreen) | null {
        return (character) => new CursesListScreen(this, character);
    }

    get Slots(): Record<string, CurseSlotData> {
        return this.Data.slots as Record<string, CurseSlotData>;
    }

    getSlot(group: string): CurseSlotData | undefined {
        return this.Slots[group];
    }

    canEdit(): boolean {
        const authority = this.ModuleManager.getModule<Authority>("authority");
        return authority?.hasPermission(Player.MemberNumber ?? -1, "curses.edit") ?? false;
    }

    /** Shareable code containing the full curse loadout. */
    exportCode(): string {
        return encodeExport("curses", jsonClone(this.Data.slots));
    }

    /** Applies a curses code (merging by slot); returns how many slots were imported. */
    importCode(code: string): number {
        const payload = decodeExport(code, "curses");
        if (typeof payload !== "object" || payload === null) {
            return 0;
        }
        const validGroups = new Set(this.curseableGroups().map((g) => g.Name as string));
        let applied = 0;
        for (const [group, raw] of Object.entries(payload as Record<string, unknown>)) {
            const slot = this.sanitizeSlot(group, raw, validGroups);
            if (slot) {
                // Imports are attributed to the importer, never the code's author
                slot.addedBy = { member: Player.MemberNumber ?? -1, name: Player.Nickname || Player.Name };
                this.Slots[group] = slot;
                applied++;
            }
        }
        if (applied > 0) {
            this.Events.emit("curseChanged", { group: "*", active: true });
        }
        return applied;
    }

    private sanitizeSlot(group: string, raw: unknown, validGroups: Set<string>): CurseSlotData | null {
        if (!validGroups.has(group) || typeof raw !== "object" || raw === null) {
            return null;
        }
        const candidate = raw as Partial<CurseSlotData>;
        const items: CurseItemSpec[] = [];
        for (const item of Array.isArray(candidate.items) ? candidate.items.slice(0, 12) : []) {
            if (typeof item !== "object" || item === null) {
                continue;
            }
            const spec = item as Partial<CurseItemSpec>;
            if (typeof spec.asset !== "string" || spec.asset.length > 64 || JSON.stringify(item).length > 10_000) {
                continue;
            }
            items.push({
                asset: spec.asset,
                name: typeof spec.name === "string" ? spec.name.slice(0, 128) : spec.asset,
                strict: spec.strict === true,
                color: spec.color,
                difficulty: typeof spec.difficulty === "number" ? spec.difficulty : undefined,
                property: spec.property,
                craft: spec.craft,
            });
        }
        return {
            group: group as AssetGroupName,
            active: candidate.active === true,
            allowEmpty: candidate.allowEmpty === true,
            items,
        };
    }

    /** Groups that can be cursed: items and clothing of the player's asset family. */
    curseableGroups(): AssetGroup[] {
        return AssetGroup.filter((g) =>
            g.Family === Player.AssetFamily
            && (g.Category === "Item" || (g.Category === "Appearance" && g.Clothing)),
        );
    }

    /** Curses a slot, capturing its current state: worn item becomes the first allowed item, empty stays empty. */
    addCurse(group: AssetGroupName, by?: Originator): CurseSlotData {
        const existing = this.Slots[group];
        if (existing) {
            return existing;
        }
        const worn = InventoryGet(Player, group);
        const slot: CurseSlotData = {
            group,
            active: true,
            allowEmpty: worn === null,
            items: worn ? [captureItemSpec(worn, true)] : [],
            addedBy: by ?? { member: Player.MemberNumber ?? -1, name: Player.Nickname || Player.Name },
        };
        this.Slots[group] = slot;
        this.Events.emit("curseChanged", { group, active: true });
        return slot;
    }

    removeCurse(group: string): void {
        if (this.Slots[group]) {
            delete this.Slots[group];
            this.Events.emit("curseChanged", { group, active: false });
        }
    }

    setActive(group: string, active: boolean): void {
        const slot = this.Slots[group];
        if (slot && slot.active !== active) {
            slot.active = active;
            this.Events.emit("curseChanged", { group, active });
        }
    }

    setAllowEmpty(group: string, value: boolean): void {
        const slot = this.Slots[group];
        if (slot) {
            slot.allowEmpty = value;
        }
    }

    setStrict(group: string, index: number, value: boolean): void {
        const spec = this.Slots[group]?.items[index];
        if (spec) {
            spec.strict = value;
        }
    }

    /** Sets a curse's conditions (sanitized); pass null/{} to clear. */
    setCurseConditions(group: string, raw: unknown): boolean {
        const slot = this.Slots[group];
        if (!slot) {
            return false;
        }
        const sanitized = sanitizeConditions(raw);
        if (sanitized === null) {
            return false;
        }
        if (Object.keys(sanitized).length === 0) {
            delete slot.conditions;
        } else {
            slot.conditions = sanitized;
        }
        return true;
    }

    /** Adds the currently worn item in the slot to its allowed list. */
    addCurrentItem(group: string): boolean {
        const slot = this.Slots[group];
        const worn = slot ? InventoryGet(Player, slot.group) : null;
        if (!slot || !worn) {
            return false;
        }
        if (slot.items.some((s) => itemMatchesSpec(worn, s))) {
            return false;
        }
        slot.items.push(captureItemSpec(worn, true));
        return true;
    }

    removeItem(group: string, index: number): void {
        this.Slots[group]?.items.splice(index, 1);
    }

    override Load(): void {
        this.tickTimer = setInterval(() => this.check(), TICK_MS);

        // Remote curse management - validated here, never trusting the requester
        this.addSyncListener("CurseCommand", (sender, content) => this.onCurseCommand(sender, content));
        this.addSyncListener("CurseCommandResult", (sender, content) => {
            if (content.ok === false) {
                BCPNotifyPlayer(`${sender.Name} rejected the curse change${typeof content.reason === "string" ? `: ${content.reason}` : "."}`);
            }
        });
    }

    private onCurseCommand(sender: Character, content: BCPMessageContent): void {
        const senderNumber = sender.MemberNumber;
        if (typeof senderNumber !== "number") {
            return;
        }
        const reject = (reason: string): void => {
            SendBCPMessage({ message: "CurseCommandResult", ok: false, group: content.group, reason }, senderNumber);
        };

        const { action, group, index, value } = content;
        if (typeof group !== "string") {
            reject("invalid command");
            return;
        }
        const authority = this.ModuleManager.getModule<Authority>("authority");
        if (!authority?.hasPermission(senderNumber, "curses.edit", group)) {
            reject("no permission for this slot");
            return;
        }
        if (this.Preset === "Dominant") {
            reject("their Dominant preset does not accept curses");
            return;
        }

        let applied = false;
        let verb = "changed the curse on";
        if (action === "addCurse" && this.curseableGroups().some((g) => g.Name === group)) {
            this.addCurse(group as AssetGroupName, { member: senderNumber, name: sender.Name });
            verb = "cursed";
            applied = true;
        } else if (action === "removeCurse" && this.Slots[group]) {
            this.removeCurse(group);
            verb = "lifted the curse on";
            applied = true;
        } else if (action === "setActive" && typeof value === "boolean" && this.Slots[group]) {
            this.setActive(group, value);
            verb = value ? "reactivated the curse on" : "suspended the curse on";
            applied = true;
        } else if (action === "setAllowEmpty" && typeof value === "boolean" && this.Slots[group]) {
            this.setAllowEmpty(group, value);
            applied = true;
        } else if (action === "setStrict" && typeof value === "boolean" && Number.isInteger(index) && this.Slots[group]?.items[index as number]) {
            this.setStrict(group, index as number, value);
            applied = true;
        } else if (action === "removeItem" && Number.isInteger(index) && this.Slots[group]?.items[index as number]) {
            this.removeItem(group, index as number);
            applied = true;
        } else if (action === "addCurrentItem" && this.Slots[group]) {
            applied = this.addCurrentItem(group);
            verb = "allowed your current item under the curse on";
        } else if (action === "setConditions" && this.Slots[group]) {
            applied = this.setCurseConditions(group, value ?? {});
            verb = "changed the conditions of the curse on";
        }

        if (!applied) {
            reject("invalid command");
            return;
        }

        const label = this.curseableGroups().find((g) => g.Name === group)?.Description ?? group;
        BCPNotifyPlayer(`${sender.Name} (#${senderNumber}) ${verb} your ${label}.`);
        this.ModuleManager.getModule<Logging>("logging")
            ?.log("curse", `${sender.Name} (#${senderNumber}) ${verb} ${label}`);
        SendBCPMessage({ message: "CurseCommandResult", ok: true, group }, senderNumber);
    }

    override Unload(): void {
        if (this.tickTimer !== null) {
            clearInterval(this.tickTimer);
            this.tickTimer = null;
        }
        super.Unload();
    }

    /** Enforcement pass: restore any cursed slot whose contents violate its specs. */
    private check(): void {
        // Pause enforcement entirely while disconnected/relogging, and never
        // enforce on a Dominant preset
        if (typeof Player === "undefined" || !Player.MemberNumber || !Array.isArray(Player.Appearance) || !ServerIsConnected
            || this.Preset === "Dominant") {
            return;
        }
        this.tickRestores = [];
        this.tickRemovals = [];
        for (const slot of Object.values(this.Slots)) {
            if (slot.active) {
                try {
                    this.checkSlot(slot);
                } catch (e) {
                    debug(`Curse check failed for ${slot.group}:`, e);
                }
            }
        }
        this.announceTick();
    }

    /** One aggregated room announcement per tick for curse effects. */
    private announceTick(): void {
        const restores = this.tickRestores;
        const removals = this.tickRemovals;
        this.tickRestores = [];
        this.tickRemovals = [];
        if ((restores.length === 0 && removals.length === 0)
            || this.Data.announce === false
            || !ServerPlayerIsInChatRoom()
            || Date.now() - this.lastAnnounce < NOTIFY_COOLDOWN_MS) {
            return;
        }
        this.lastAnnounce = Date.now();

        const name = Player.Nickname || Player.Name;
        const possessive = Player.GetPronouns() === "HeHim" ? "his" : "her";
        const slotName = (group: string): string =>
            (this.curseableGroups().find((g) => g.Name === group)?.Description ?? group).toLocaleLowerCase();

        let text: string;
        if (restores.length > 0 && removals.length > 0) {
            text = `Multiple curses on ${name} have taken effect.`;
        } else if (removals.length === 1) {
            text = `The curse on ${name}'s ${slotName(removals[0]!.group)} causes ${possessive} ${removals[0]!.itemName} to fall off.`;
        } else if (removals.length === 2) {
            text = `The curses on ${name}'s ${slotName(removals[0]!.group)} and ${slotName(removals[1]!.group)} cause ${possessive} items to fall off.`;
        } else if (removals.length > 2) {
            text = `Multiple curses on ${name} cause ${possessive} items to fall off.`;
        } else if (restores.length === 1) {
            text = `The curse on ${name}'s ${slotName(restores[0]!.group)} has caused ${possessive} ${restores[0]!.itemName} to reappear.`;
        } else if (restores.length === 2) {
            text = `The curses on ${name}'s ${slotName(restores[0]!.group)} and ${slotName(restores[1]!.group)} have caused ${possessive} items to reappear.`;
        } else {
            text = `Multiple cursed items on ${name} are now in effect and have reappeared.`;
        }
        SendAction(text);
    }

    private checkSlot(slot: CurseSlotData): void {
        const suspended = this.suspendedUntil.get(slot.group) ?? 0;
        if (Date.now() < suspended) {
            return;
        }

        // Timer expiry ends the curse
        if (conditionsExpired(slot.conditions)) {
            const label = this.curseableGroups().find((g) => g.Name === slot.group)?.Description ?? slot.group;
            if (slot.conditions?.timerAction === "remove") {
                this.removeCurse(slot.group);
                BCPNotifyPlayer(`The curse on your ${label} has lifted.`);
            } else {
                if (slot.conditions) {
                    delete slot.conditions.timerEnd;
                    delete slot.conditions.timerAction;
                }
                this.setActive(slot.group, false);
                BCPNotifyPlayer(`The curse on your ${label} has expired.`);
            }
            return;
        }

        // Requirements gate enforcement without ending the curse
        if (!conditionsMet(slot.conditions, this.ModuleManager.getModule<Roles>("roles"))) {
            this.consecutiveRestores.delete(slot.group);
            return;
        }

        const worn = InventoryGet(Player, slot.group);

        if (!worn) {
            if (slot.allowEmpty || slot.items.length === 0) {
                this.consecutiveRestores.delete(slot.group);
                return;
            }
            debug(`Curse violation on ${slot.group}: slot empty, expected ${slot.items[0]!.asset}`);
            this.restore(slot, slot.items[0]!, "add");
            return;
        }

        const spec = slot.items.find((s) => s.asset === worn.Asset.Name);
        if (!spec) {
            debug(`Curse violation on ${slot.group}: ${worn.Asset.Name} is not an allowed item`);
            if (slot.items.length === 0) {
                this.restore(slot, null, "remove");
            } else if (!slot.allowEmpty) {
                this.restore(slot, slot.items[0]!, "swap");
            } else {
                this.restore(slot, null, "remove");
            }
            return;
        }
        if (spec.strict && !itemMatchesSpec(worn, spec)) {
            debug(`Curse violation on ${slot.group}: state mismatch`, {
                worn: { color: worn.Color, difficulty: worn.Difficulty, property: worn.Property, craft: worn.Craft },
                spec: { color: spec.color, difficulty: spec.difficulty, property: spec.property, craft: spec.craft },
            });
            this.restore(slot, spec, "update");
            return;
        }

        // Slot is compliant - the fight (if any) is over
        this.consecutiveRestores.delete(slot.group);
    }

    private restore(slot: CurseSlotData, spec: CurseItemSpec | null, action: "add" | "remove" | "swap" | "update"): void {
        const now = Date.now();
        const last = this.lastRestore.get(slot.group) ?? 0;
        if (now - last < RESTORE_COOLDOWN_MS) {
            return;
        }
        this.lastRestore.set(slot.group, now);

        const failures = (this.consecutiveRestores.get(slot.group) ?? 0) + 1;
        this.consecutiveRestores.set(slot.group, failures);
        if (failures > MAX_CONSECUTIVE_RESTORES) {
            this.suspendedUntil.set(slot.group, now + SUSPEND_MS);
            this.consecutiveRestores.delete(slot.group);
            const groupName = this.curseableGroups().find((g) => g.Name === slot.group)?.Description ?? slot.group;
            err(`Curse on ${slot.group} is not converging (something keeps rejecting the restore) - pausing enforcement for ${SUSPEND_MS / 1000}s`);
            BCPNotifyPlayer(`The curse on your ${groupName} could not hold and is resting for a minute.`);
            return;
        }

        if (spec === null) {
            const removed = InventoryGet(Player, slot.group);
            if (removed) {
                this.tickRemovals.push({
                    group: slot.group,
                    itemName: removed.Craft?.Name || removed.Asset.Description,
                });
            }
            InventoryRemove(Player, slot.group, true);
        } else {
            const item = InventoryWear(
                Player,
                spec.asset,
                slot.group,
                spec.color ?? null,
                spec.difficulty ?? null,
                Player.MemberNumber,
                spec.craft ?? null,
                true,
            );
            if (item && spec.property !== undefined) {
                item.Property = jsonClone(spec.property);
                CharacterRefresh(Player, false);
            }
            // Adopt the as-restored state so the next tick compares equal -
            // default colors/asset properties can differ from the capture and
            // would otherwise re-trigger forever (fight loop)
            const worn = InventoryGet(Player, slot.group);
            if (worn && worn.Asset.Name === spec.asset) {
                adoptRestoredState(spec, worn);
            } else {
                err(`Curse restore on ${slot.group} did not stick: expected ${spec.asset}, slot now has ${worn?.Asset.Name ?? "nothing"}`);
            }
            if (action === "add" || action === "swap") {
                this.tickRestores.push({ group: slot.group, itemName: spec.name });
            }
        }
        if (ServerPlayerIsInChatRoom()) {
            ChatRoomCharacterUpdate(Player);
        }
        debug(`Curse restored ${slot.group} (${action})`);
        const lastNotified = this.lastNotify.get(slot.group) ?? 0;
        if (now - lastNotified >= NOTIFY_COOLDOWN_MS) {
            this.lastNotify.set(slot.group, now);
            const groupName = this.curseableGroups().find((g) => g.Name === slot.group)?.Description ?? slot.group;
            BCPNotifyPlayer(`The curse on your ${groupName} reasserted itself.`);
            this.Events.emit("curseTriggered", { group: slot.group, action });
        }
    }
}
