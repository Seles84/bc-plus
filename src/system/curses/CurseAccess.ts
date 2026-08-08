import { CurseSlotData } from "@/system/curses/CurseTypes";
import { SendBCPMessage } from "@/utils/Messaging";
import type { ConditionData } from "@/system/conditions/Conditions";
import type Curses from "@/modules/Curses";
import type Authority from "@/modules/Authority";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";

/**
 * Uniform interface for the curses screens: the player's own curses
 * (local, direct) or another character's (mirror + validated commands).
 */
export interface CurseAccess {
    slots(): Record<string, CurseSlotData>;
    slot(group: string): CurseSlotData | undefined;
    canEdit(): boolean;
    /** The character whose appearance is consulted (for worn-item display) */
    subject(): Character;
    addCurse(group: AssetGroupName): void;
    removeCurse(group: string): void;
    setActive(group: string, value: boolean): void;
    setAllowEmpty(group: string, value: boolean): void;
    setStrict(group: string, index: number, value: boolean): void;
    removeItem(group: string, index: number): void;
    addCurrentItem(group: string): void;
    setConditions(group: string, conditions: ConditionData): void;
}

export class LocalCurseAccess implements CurseAccess {

    constructor(private readonly curses: Curses) {}

    slots(): Record<string, CurseSlotData> {
        return this.curses.Slots;
    }

    slot(group: string): CurseSlotData | undefined {
        return this.curses.getSlot(group);
    }

    canEdit(): boolean {
        return this.curses.canEdit();
    }

    subject(): Character {
        return Player;
    }

    addCurse(group: AssetGroupName): void {
        this.curses.addCurse(group);
    }

    removeCurse(group: string): void {
        this.curses.removeCurse(group);
    }

    setActive(group: string, value: boolean): void {
        this.curses.setActive(group, value);
    }

    setAllowEmpty(group: string, value: boolean): void {
        this.curses.setAllowEmpty(group, value);
    }

    setStrict(group: string, index: number, value: boolean): void {
        this.curses.setStrict(group, index, value);
    }

    removeItem(group: string, index: number): void {
        this.curses.removeItem(group, index);
    }

    addCurrentItem(group: string): void {
        this.curses.addCurrentItem(group);
    }

    setConditions(group: string, conditions: ConditionData): void {
        this.curses.setCurseConditions(group, conditions);
    }
}

/**
 * Remote curses: reads the DataSync mirror; every edit is a CurseCommand
 * the target's client validates and applies (captures happen there too,
 * against THEIR current appearance). No optimistic writes - the target's
 * change-broadcast refreshes the mirror within moments.
 */
export class RemoteCurseAccess implements CurseAccess {

    constructor(
        private readonly curses: Curses,
        private readonly authority: Authority | undefined,
        private readonly character: BCPlusCharacter,
    ) {}

    slots(): Record<string, CurseSlotData> {
        const mirror = this.character.BCPData?.["curses"];
        return (mirror?.["slots"] ?? {}) as Record<string, CurseSlotData>;
    }

    slot(group: string): CurseSlotData | undefined {
        return this.slots()[group];
    }

    canEdit(): boolean {
        return this.authority?.remoteHasPermission(this.character, "curses.edit") ?? false;
    }

    subject(): Character {
        return this.character.Character;
    }

    addCurse(group: AssetGroupName): void {
        this.send("addCurse", group);
    }

    removeCurse(group: string): void {
        this.send("removeCurse", group);
    }

    setActive(group: string, value: boolean): void {
        this.send("setActive", group, { value });
    }

    setAllowEmpty(group: string, value: boolean): void {
        this.send("setAllowEmpty", group, { value });
    }

    setStrict(group: string, index: number, value: boolean): void {
        this.send("setStrict", group, { index, value });
    }

    removeItem(group: string, index: number): void {
        this.send("removeItem", group, { index });
    }

    addCurrentItem(group: string): void {
        this.send("addCurrentItem", group);
    }

    setConditions(group: string, conditions: ConditionData): void {
        this.send("setConditions", group, { value: conditions });
    }

    private send(action: string, group: string, extra: Record<string, unknown> = {}): void {
        SendBCPMessage({
            message: "CurseCommand",
            action,
            group,
            ...extra,
        }, this.character.MemberNumber);
    }
}
