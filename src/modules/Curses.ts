import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig, PermissionDefinition } from "@/system/module/ModuleTypes";
import { BCPLUS_AUTHOR, BCPLUS_VERSION } from "@/system/Constants";
import { Role } from "@/system/Roles";
import { CurseItemSpec, CurseSlotData, captureItemSpec, itemMatchesSpec } from "@/system/curses/CurseTypes";
import { CursesListScreen } from "@/gui/CursesScreen";
import { GUIScreen } from "@/system/gui/GUIScreen";
import { BCPNotifyPlayer } from "@/utils/Messaging";
import { debug } from "@/system/Console";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";
import type Authority from "@/modules/Authority";

const TICK_MS = 1500;
/** Minimum time between restorations of the same slot, to avoid fighting loops. */
const RESTORE_COOLDOWN_MS = 1200;

export default class Curses extends ModuleInstance {

    private tickTimer: ReturnType<typeof setInterval> | null = null;
    private readonly lastRestore = new Map<string, number>();

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
        return { slots: {} };
    }

    override get HasGUI(): boolean {
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

    /** Groups that can be cursed: items and clothing of the player's asset family. */
    curseableGroups(): AssetGroup[] {
        return AssetGroup.filter((g) =>
            g.Family === Player.AssetFamily
            && (g.Category === "Item" || (g.Category === "Appearance" && g.Clothing)),
        );
    }

    /** Curses a slot, capturing its current state: worn item becomes the first allowed item, empty stays empty. */
    addCurse(group: AssetGroupName): CurseSlotData {
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
        // Pause enforcement entirely while disconnected/relogging
        if (typeof Player === "undefined" || !Player.MemberNumber || !Array.isArray(Player.Appearance) || !ServerIsConnected) {
            return;
        }
        for (const slot of Object.values(this.Slots)) {
            if (slot.active) {
                try {
                    this.checkSlot(slot);
                } catch (e) {
                    debug(`Curse check failed for ${slot.group}:`, e);
                }
            }
        }
    }

    private checkSlot(slot: CurseSlotData): void {
        const worn = InventoryGet(Player, slot.group);

        if (!worn) {
            if (slot.allowEmpty || slot.items.length === 0) {
                return;
            }
            this.restore(slot, slot.items[0]!, "add");
            return;
        }

        const spec = slot.items.find((s) => s.asset === worn.Asset.Name);
        if (!spec) {
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
            this.restore(slot, spec, "update");
        }
    }

    private restore(slot: CurseSlotData, spec: CurseItemSpec | null, action: "add" | "remove" | "swap" | "update"): void {
        const now = Date.now();
        const last = this.lastRestore.get(slot.group) ?? 0;
        if (now - last < RESTORE_COOLDOWN_MS) {
            return;
        }
        this.lastRestore.set(slot.group, now);

        if (spec === null) {
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
                item.Property = structuredClone(spec.property);
                CharacterRefresh(Player, false);
            }
        }
        if (ServerPlayerIsInChatRoom()) {
            ChatRoomCharacterUpdate(Player);
        }
        const groupName = this.curseableGroups().find((g) => g.Name === slot.group)?.Description ?? slot.group;
        BCPNotifyPlayer(`The curse on your ${groupName} reasserted itself.`);
        debug(`Curse restored ${slot.group} (${action})`);
        this.Events.emit("curseTriggered", { group: slot.group, action });
    }
}
