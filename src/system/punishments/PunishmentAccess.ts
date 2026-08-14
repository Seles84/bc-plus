import { ActivePunishment, PunishmentDefinition } from "@/system/punishments/PunishmentTypes";
import { SendBCPMessage } from "@/utils/Messaging";
import type Punishments from "@/modules/Punishments";
import type Authority from "@/modules/Authority";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";

/**
 * Uniform interface for the punishments screens: the player's own (local,
 * direct) or another character's (mirror + validated commands).
 */
export interface PunishmentAccess {
    definitions(): Record<string, PunishmentDefinition>;
    active(): Record<string, ActivePunishment>;
    canEdit(): boolean;
    canLift(): boolean;
    /** The character whose appearance is consulted (for worn-item display) */
    subject(): Character;
    createFromWorn(group: AssetGroupName): void;
    createRule(rule: string): void;
    remove(id: string): void;
    setName(id: string, value: string): void;
    setDuration(id: string, minutes: number): void;
    setLock(id: string, lock: string): void;
    setAnnounce(id: string, value: boolean): void;
    apply(id: string): void;
    lift(id: string): void;
}

export class LocalPunishmentAccess implements PunishmentAccess {

    constructor(private readonly punishments: Punishments) {}

    definitions(): Record<string, PunishmentDefinition> {
        return this.punishments.Definitions;
    }

    active(): Record<string, ActivePunishment> {
        return this.punishments.Active;
    }

    canEdit(): boolean {
        return this.punishments.canEdit();
    }

    canLift(): boolean {
        return this.punishments.canLift();
    }

    subject(): Character {
        return Player;
    }

    createFromWorn(group: AssetGroupName): void {
        this.punishments.createFromWorn(group);
    }

    createRule(rule: string): void {
        this.punishments.createRulePunishment(rule);
    }

    remove(id: string): void {
        this.punishments.removeDefinition(id);
    }

    setName(id: string, value: string): void {
        this.punishments.setName(id, value);
    }

    setDuration(id: string, minutes: number): void {
        this.punishments.setDuration(id, minutes);
    }

    setLock(id: string, lock: string): void {
        this.punishments.setLock(id, lock);
    }

    setAnnounce(id: string, value: boolean): void {
        this.punishments.setAnnounce(id, value);
    }

    apply(id: string): void {
        this.punishments.applyPunishment(id, "manual", "stack", Player.Nickname || Player.Name);
    }

    lift(id: string): void {
        this.punishments.endPunishment(id, "lifted", Player.Nickname || Player.Name);
    }
}

/**
 * Remote punishments: reads the DataSync mirror; every edit is a
 * PunishmentCommand the target's client validates and applies (worn-item
 * captures happen there, against THEIR appearance). No optimistic writes -
 * the target's change-broadcast refreshes the mirror within moments.
 */
export class RemotePunishmentAccess implements PunishmentAccess {

    constructor(
        private readonly authority: Authority | undefined,
        private readonly character: BCPlusCharacter,
    ) {}

    definitions(): Record<string, PunishmentDefinition> {
        const mirror = this.character.BCPData?.["punishments"];
        return (mirror?.["punishments"] ?? {}) as Record<string, PunishmentDefinition>;
    }

    active(): Record<string, ActivePunishment> {
        const mirror = this.character.BCPData?.["punishments"];
        return (mirror?.["active"] ?? {}) as Record<string, ActivePunishment>;
    }

    canEdit(): boolean {
        return this.authority?.remoteHasPermission(this.character, "punishments.edit") ?? false;
    }

    canLift(): boolean {
        return this.authority?.remoteHasPermission(this.character, "punishments.lift") ?? false;
    }

    subject(): Character {
        return this.character.Character;
    }

    createFromWorn(group: AssetGroupName): void {
        this.send("createFromWorn", undefined, group);
    }

    createRule(rule: string): void {
        this.send("createRule", undefined, rule);
    }

    remove(id: string): void {
        this.send("remove", id);
    }

    setName(id: string, value: string): void {
        this.send("setName", id, value);
    }

    setDuration(id: string, minutes: number): void {
        this.send("setDuration", id, minutes);
    }

    setLock(id: string, lock: string): void {
        this.send("setLock", id, lock);
    }

    setAnnounce(id: string, value: boolean): void {
        this.send("setAnnounce", id, value);
    }

    apply(id: string): void {
        this.send("apply", id);
    }

    lift(id: string): void {
        this.send("lift", id);
    }

    private send(action: string, id?: string, value?: unknown): void {
        SendBCPMessage({
            message: "PunishmentCommand",
            action,
            id,
            value,
        }, this.character.MemberNumber);
    }
}
