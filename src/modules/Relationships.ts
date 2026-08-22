import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig, PermissionDefinition } from "@/system/module/ModuleTypes";
import { BCPLUS_AUTHOR, BCPLUS_VERSION } from "@/system/Constants";
import { Role } from "@/system/Roles";
import { GUIScreen } from "@/system/gui/GUIScreen";
import { RelationshipsScreen } from "@/gui/RelationshipsScreen";
import { BCPNotifyPlayer, MemberNumberToName, SendBCPMessage } from "@/utils/Messaging";
import { containsWord, spokenPayload, spokenText } from "@/rules/speechUtils";
import { decodeExport, encodeExport } from "@/utils/ExportImport";
import { jsonClone } from "@/utils/BCUtils";
import { debug } from "@/system/Console";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";
import type Authority from "@/modules/Authority";
import type Logging from "@/modules/Logging";
import type Core from "@/modules/Core";

export interface RelationshipEntry {
    /** The name the player uses for this person (replaces their name for the player). */
    nickname: string;
    /** Whether the player is blocked from using the person's real name in chat. */
    enforce: boolean;
}

export const NICKNAME_MAX = 20;

/** Same constraints BC applies to its own nicknames. */
export function isValidCustomName(nickname: string): boolean {
    return nickname.trim() === nickname
        && nickname.length > 0
        && nickname.length <= NICKNAME_MAX
        && ServerCharacterNicknameRegex.test(nickname);
}

/**
 * Custom names: how the player sees other people, and - when enforced -
 * the only name the player may call them in chat. The list is private;
 * others may view or manage it only through the permissions.
 */
export default class Relationships extends ModuleInstance {

    /** Fetched lists of other characters: entries, "denied", "pending", or "timeout". */
    private readonly remoteEntries = new Map<number, Record<string, RelationshipEntry> | "denied" | "pending" | "timeout">();

    /** True while BC is rendering a context where custom names should show. */
    private replaceNames = false;

    protected readonly SystemConfig: ModuleConfig = {
        Name: "Relationships",
        Version: BCPLUS_VERSION,
        Author: BCPLUS_AUTHOR,
        Description: "Custom names for other people, optionally enforced in chat",
        Active: true,
        Icon: "Icons/FriendList.png",
        HoverText: "Give people custom names: the player sees that name instead of the real one "
            + "in the chat room, and enforced entries also block the player from using the "
            + "person's real name in chat or whispers.",
        PublicData: false,
        Reference: "relationships",
        MenuString: "Relationships",
    };

    override get Permissions(): PermissionDefinition[] {
        return [
            {
                id: "relationships.view",
                label: "View my relationship list",
                defaultRole: Role.Mistress,
                defaultSelf: true,
            },
            {
                id: "relationships.edit",
                label: "Manage my relationships (custom names)",
                defaultRole: Role.Owner,
                defaultSelf: true,
            },
        ];
    }

    override get Defaults(): Record<string, unknown> {
        return { entries: {} };
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

    override get SettingsScreen(): ((character: BCPlusCharacter | null) => GUIScreen) | null {
        return (character) => new RelationshipsScreen(this, character);
    }

    /** Custom name entries keyed by member number (mutable, auto-synced). */
    get Entries(): Record<string, RelationshipEntry> {
        return this.Data.entries as Record<string, RelationshipEntry>;
    }

    /** The custom name for a member, or null when none is set. */
    getNickname(memberNumber: number): string | null {
        return this.Entries[memberNumber.toString()]?.nickname ?? null;
    }

    /** Creates or updates an entry; returns false when the nickname is invalid. */
    setEntry(memberNumber: number, nickname: string, enforce: boolean): boolean {
        if (!Number.isInteger(memberNumber) || memberNumber < 0 || !isValidCustomName(nickname)) {
            return false;
        }
        this.Entries[memberNumber.toString()] = { nickname, enforce };
        return true;
    }

    removeEntry(memberNumber: number): void {
        delete this.Entries[memberNumber.toString()];
    }

    /** Whether the local player may edit their own list. */
    canEdit(): boolean {
        const authority = this.ModuleManager.getModule<Authority>("authority");
        return authority?.hasPermission(Player.MemberNumber ?? -1, "relationships.edit") ?? false;
    }

    /** Shareable code containing every custom name entry. */
    exportCode(): string {
        return encodeExport("relationships", jsonClone(this.Data.entries));
    }

    /** Applies a relationships code (merged by member); returns how many entries were imported. */
    importCode(code: string): number {
        const payload = decodeExport(code, "relationships");
        if (typeof payload !== "object" || payload === null) {
            return 0;
        }
        let applied = 0;
        for (const [key, raw] of Object.entries(payload as Record<string, unknown>)) {
            const member = Number.parseInt(key, 10);
            const entry = raw as Partial<RelationshipEntry> | null;
            if (!Number.isInteger(member) || member < 0
                || typeof entry !== "object" || entry === null
                || typeof entry.nickname !== "string") {
                continue;
            }
            // setEntry re-validates the nickname like any other write
            if (this.setEntry(member, entry.nickname, entry.enforce === true)) {
                applied++;
            }
        }
        return applied;
    }

    // --- Remote access (their client validates everything) ---

    getRemoteEntries(memberNumber: number): Record<string, RelationshipEntry> | "denied" | "pending" | "timeout" | undefined {
        return this.remoteEntries.get(memberNumber);
    }

    /** Requests another character's list; the result arrives via getRemoteEntries. */
    requestEntries(memberNumber: number): void {
        this.remoteEntries.set(memberNumber, "pending");
        SendBCPMessage({ message: "RelationshipsRequest" }, memberNumber);
        setTimeout(() => {
            if (this.remoteEntries.get(memberNumber) === "pending") {
                debug(`Relationships request to #${memberNumber} timed out`);
                this.remoteEntries.set(memberNumber, "timeout");
                this.Events.emit("relationshipsReceived", { memberNumber });
            }
        }, 10_000);
    }

    /** Asks another character to add/update an entry on their list. */
    requestSet(target: number, aboutMember: number, nickname: string, enforce: boolean): void {
        SendBCPMessage({ message: "RelationshipCommand", action: "set", member: aboutMember, nickname, enforce }, target);
    }

    /** Asks another character to remove an entry from their list. */
    requestRemove(target: number, aboutMember: number): void {
        SendBCPMessage({ message: "RelationshipCommand", action: "remove", member: aboutMember }, target);
    }

    override Load(): void {
        this.installNameReplacement();
        this.installSpeechEnforcement();

        // Remote viewing: request/response, gated by relationships.view on OUR side
        this.addSyncListener("RelationshipsRequest", (sender) => {
            const senderNumber = sender.MemberNumber;
            if (typeof senderNumber !== "number") {
                return;
            }
            const authority = this.ModuleManager.getModule<Authority>("authority");
            if (!authority?.hasPermission(senderNumber, "relationships.view")) {
                SendBCPMessage({ message: "RelationshipsResponse", denied: true }, senderNumber);
                return;
            }
            SendBCPMessage({ message: "RelationshipsResponse", entries: jsonClone(this.Entries) }, senderNumber);
        });

        this.addSyncListener("RelationshipsResponse", (sender, content) => {
            const senderNumber = sender.MemberNumber;
            if (typeof senderNumber !== "number") {
                return;
            }
            if (content.denied === true || typeof content.entries !== "object" || content.entries === null) {
                this.remoteEntries.set(senderNumber, "denied");
            } else {
                const entries: Record<string, RelationshipEntry> = {};
                for (const [key, entry] of Object.entries(content.entries as Record<string, Partial<RelationshipEntry>>)) {
                    if (entry && typeof entry.nickname === "string") {
                        entries[key] = { nickname: entry.nickname, enforce: entry.enforce === true };
                    }
                }
                this.remoteEntries.set(senderNumber, entries);
            }
            this.Events.emit("relationshipsReceived", { memberNumber: senderNumber });
        });

        // Remote editing: validated HERE - the requester is never trusted
        this.addSyncListener("RelationshipCommand", (sender, content) => {
            const senderNumber = sender.MemberNumber;
            if (typeof senderNumber !== "number") {
                return;
            }
            const reject = (reason: string): void => {
                SendBCPMessage({ message: "RelationshipCommandResult", ok: false, reason }, senderNumber);
            };
            const hardcore = this.ModuleManager.getModule<Core>("core")?.hardcoreSenderBlock(senderNumber);
            if (hardcore) {
                reject(hardcore);
                return;
            }
            const { action, member } = content;
            if ((action !== "set" && action !== "remove") || typeof member !== "number"
                || !Number.isInteger(member) || member < 0) {
                reject("invalid command");
                return;
            }
            const authority = this.ModuleManager.getModule<Authority>("authority");
            if (!authority?.hasPermission(senderNumber, "relationships.edit")) {
                reject("no permission");
                return;
            }
            const memberName = MemberNumberToName(member);
            if (action === "set") {
                const { nickname, enforce } = content;
                if (typeof nickname !== "string" || !isValidCustomName(nickname)) {
                    reject("invalid name");
                    return;
                }
                this.setEntry(member, nickname, enforce === true);
                BCPNotifyPlayer(`${sender.Name} (#${senderNumber}) set your name for ${memberName} (#${member}) `
                    + `to "${nickname}"${enforce === true ? " - you must use it" : ""}.`);
                this.ModuleManager.getModule<Logging>("logging")?.log("relationship",
                    `${sender.Name} (#${senderNumber}) set the custom name for ${memberName} (#${member}) to "${nickname}"${enforce === true ? " (enforced)" : ""}`);
            } else {
                if (this.Entries[member.toString()] === undefined) {
                    reject("no entry");
                    return;
                }
                this.removeEntry(member);
                BCPNotifyPlayer(`${sender.Name} (#${senderNumber}) removed your custom name for ${memberName} (#${member}).`);
                this.ModuleManager.getModule<Logging>("logging")?.log("relationship",
                    `${sender.Name} (#${senderNumber}) removed the custom name for ${memberName} (#${member})`);
            }
            SendBCPMessage({ message: "RelationshipCommandResult", ok: true }, senderNumber);
            // Refresh the requester's view of the list
            SendBCPMessage({ message: "RelationshipsResponse", entries: jsonClone(this.Entries) }, senderNumber);
        });

        this.addSyncListener("RelationshipCommandResult", (sender, content) => {
            if (content.ok === false) {
                BCPNotifyPlayer(`${sender.Name} rejected the change${typeof content.reason === "string" ? `: ${content.reason}` : "."}`);
            }
        });
    }

    /**
     * Shows custom names in place of real ones - but only in display contexts
     * (chat room canvas, chat messages, whisper target), never in data BC
     * sends to the server.
     */
    private installNameReplacement(): void {
        this.addHook("CharacterNickname", 4, (args, next) => {
            const character = args[0];
            if (this.replaceNames && character && typeof character.MemberNumber === "number") {
                const nickname = this.getNickname(character.MemberNumber);
                if (nickname !== null) {
                    return nickname;
                }
            }
            return next(args);
        });
        this.addHook("ChatRoomRun", 0, (args, next) => {
            this.replaceNames = true;
            try {
                return next(args);
            } finally {
                this.replaceNames = false;
            }
        });
        this.addHook("ChatRoomMessage", 4, (args, next) => {
            const data = args[0] as { Type?: string } | undefined;
            const previous = this.replaceNames;
            if (data && ["Action", "Chat", "Whisper", "Emote", "Activity", "ServerMessage"].includes(data.Type ?? "")) {
                this.replaceNames = true;
            }
            try {
                return next(args);
            } finally {
                this.replaceNames = previous;
            }
        });
        this.addHook("CommandParse", 0, (args, next) => {
            const previous = this.replaceNames;
            if (ChatRoomTargetMemberNumber >= 0) {
                this.replaceNames = true;
            }
            try {
                return next(args);
            } finally {
                this.replaceNames = previous;
            }
        });
    }

    /** Blocks chat/whispers using the real name of anyone with an enforced entry. */
    private installSpeechEnforcement(): void {
        this.addHook("ServerSend", 5, (args, next) => {
            const payload = spokenPayload(args as unknown[]);
            if (payload === null) {
                return next(args);
            }
            const violation = this.findNameViolation(spokenText(payload.Content));
            if (violation === null) {
                return next(args);
            }
            BCPNotifyPlayer(`You must call ${violation.nickname} by that name - "${violation.used}" is not yours to use.`);
            return;
        });
    }

    /**
     * The first enforced real name used in the text, or null. OOC segments are
     * exempt (the caller passes spoken text only); a real name that is part of
     * a custom name used in the same text is allowed ("Lana" in "Mistress Lana").
     */
    private findNameViolation(text: string): { used: string; nickname: string } | null {
        if (text.length === 0 || typeof ChatRoomCharacter === "undefined" || ChatRoomCharacter === null) {
            return null;
        }
        const allowed = Object.values(this.Entries).map((entry) => entry.nickname.toLocaleLowerCase());
        for (const character of ChatRoomCharacter) {
            if (typeof character.MemberNumber !== "number" || character.MemberNumber === Player.MemberNumber) {
                continue;
            }
            const entry = this.Entries[character.MemberNumber.toString()];
            if (!entry?.enforce) {
                continue;
            }
            const nickname = entry.nickname.toLocaleLowerCase();
            const realNames = [character.Name, character.Nickname]
                .filter((name): name is string => typeof name === "string" && name.length > 0)
                .map((name) => name.toLocaleLowerCase())
                .filter((name) => name !== nickname);
            for (const name of realNames) {
                if (!containsWord(text, name)) {
                    continue;
                }
                const covered = allowed.some((custom) => containsWord(custom, name) && containsWord(text, custom));
                if (!covered) {
                    return { used: name, nickname: entry.nickname };
                }
            }
        }
        return null;
    }
}
