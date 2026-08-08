import { err } from "@/system/Console";

export interface BCPMessageContent {
    message: string;
    [key: string]: unknown;
}

export function ContentIsBCPMessage(content: ServerChatRoomMessage): boolean {
    return content.Type === "Hidden"
        && content.Content === "BCP"
        && Array.isArray(content.Dictionary)
        && content.Dictionary.length === 1;
}

export function GetBCPMessageFromChat(message: ServerChatRoomMessage): BCPMessageContent | null {
    if (!ContentIsBCPMessage(message)) {
        return null;
    }
    const payload = message.Dictionary![0] as unknown as BCPMessageContent;
    return typeof payload.message === "string" ? payload : null;
}

/** Sends a hidden BC+ message to the room, or to a single member when `target` is set. */
export function SendBCPMessage(message: BCPMessageContent, target?: number): void {
    if (!ServerPlayerIsInChatRoom()) {
        return;
    }
    ServerSend("ChatRoomChat", {
        Type: "Hidden",
        Content: "BCP",
        Dictionary: [message],
        Target: target,
    } as unknown as ServerChatRoomMessage);
}

/** Sends an action-style message visible in chat, to the room or one character. */
export function SendAction(content: string, target?: Character, dictionary: ChatMessageDictionary = []): void {
    ServerSend("ChatRoomChat", {
        Content: "MayaScript",
        Type: "Activity",
        Dictionary: [{
            Tag: "MISSING ACTIVITY DESCRIPTION FOR KEYWORD MayaScript",
            Text: content,
        }, ...dictionary],
        Target: target?.MemberNumber,
    } as unknown as ServerChatRoomMessage);
}

/** Sends an emote to the room or one character. */
export function SendEmote(content: string, target?: Character): void {
    ServerSend("ChatRoomChat", {
        Content: content,
        Type: "Emote",
        Target: target?.MemberNumber,
    });
}

/** Displays text to the local player only. */
export function NotifyPlayer(content: string, timeout?: number): void {
    const darkTheme = Player.ChatSettings?.ColorTheme === "Dark" || Player.ChatSettings?.ColorTheme === "Dark2";
    ChatRoomSendLocal(`<p style='background-color:#00c2ff;color:${darkTheme ? "white" : "black"};margin-bottom:0.25em;margin-top:0'>${content}</p>`, timeout);
}

/** Displays text to the local player, marked as coming from BC+. */
export function BCPNotifyPlayer(content: string, timeout?: number): void {
    NotifyPlayer(`BC+: ${content}`, timeout);
}

/**
 * Finds a character in the chat room by member number, name, or nickname
 * (case-insensitive; member number wins on ambiguity).
 */
export function FindCharacterInRoom(search: string | number, {
    MemberNumber = true,
    Nickname = true,
    Name = true,
} = {}): Character | null {
    const query = search.toString().toLocaleLowerCase();
    for (const character of ChatRoomCharacter) {
        if (
            (MemberNumber && character.MemberNumber === Number(query))
            || (Nickname && character.Nickname?.toLocaleLowerCase() === query)
            || (Name && character.Name.toLocaleLowerCase() === query)
        ) {
            return character;
        }
    }
    return null;
}

export function MemberNumberToName(member: number, notFound: string = "Unknown"): string {
    if (member === Player.MemberNumber) {
        return Player.Name;
    }
    const friend = Player.FriendNames?.get(member);
    if (friend) {
        return friend;
    }
    const inRoom = FindCharacterInRoom(member, { MemberNumber: true, Nickname: false, Name: false });
    return inRoom?.Name ?? notFound;
}

export function ArrayToReadableString(arr: string[]): string {
    if (arr.length <= 1) {
        return arr[0] ?? "";
    }
    if (arr.length === 2) {
        return `${arr[0]} and ${arr[1]}`;
    }
    return `${arr.slice(0, -1).join(", ")}, and ${arr[arr.length - 1]}`;
}

type MessageAction = (sender: Character, content: BCPMessageContent) => void;

interface SyncListener {
    /** Slug of the owning module (listeners are removed when it unloads) */
    owner: string;
    message: string;
    action: MessageAction;
}

const syncListeners: SyncListener[] = [];

/** Registers a handler for an incoming BC+ message type. */
export function AddSyncListener(owner: string, message: string, action: MessageAction): void {
    syncListeners.push({ owner, message, action });
}

/** Removes every listener owned by the given module slug. */
export function RemoveSyncListeners(owner: string): void {
    for (let i = syncListeners.length - 1; i >= 0; i--) {
        if (syncListeners[i]!.owner === owner) {
            syncListeners.splice(i, 1);
        }
    }
}

/** @internal Dispatches an incoming BC+ message to all matching listeners. */
export function DispatchBCPMessage(sender: Character, content: BCPMessageContent): void {
    for (const listener of [...syncListeners]) {
        if (listener.message === content.message) {
            try {
                listener.action(sender, content);
            } catch (e) {
                err(`Sync listener for "${content.message}" (${listener.owner}) failed:`, e);
            }
        }
    }
}
