import { debug, err } from "@/system/Console";
import { knownMember } from "@/utils/MemberCache";

export interface BCPMessageContent {
    message: string;
    [key: string]: unknown;
}

/**
 * BC+ payloads ride in `Dictionary` as a plain OBJECT, not an array.
 * The BC server validates array dictionary entries against its known
 * schemas and strips custom ones, but passes object dictionaries through
 * untouched on Hidden messages (the same mechanism BCX uses).
 */
export function ContentIsBCPMessage(content: ServerChatRoomMessage): boolean {
    const dictionary = content.Dictionary as unknown;
    return content.Type === "Hidden"
        && content.Content === "BCP"
        && typeof dictionary === "object"
        && dictionary !== null
        && !Array.isArray(dictionary)
        && typeof (dictionary as BCPMessageContent).message === "string";
}

export function GetBCPMessageFromChat(message: ServerChatRoomMessage): BCPMessageContent | null {
    return ContentIsBCPMessage(message)
        ? message.Dictionary as unknown as BCPMessageContent
        : null;
}

/** Sends a hidden BC+ message to the room, or to a single member when `target` is set. */
export function SendBCPMessage(message: BCPMessageContent, target?: number): void {
    // ChatRoomData is set before the screen switch finishes during an async
    // room join - accept either signal so announcements are not dropped.
    if (!ServerIsConnected || (!ServerPlayerIsInChatRoom() && ChatRoomData == null)) {
        err(`Dropped BCP message "${message.message}" - not connected/in a chat room`);
        return;
    }
    debug(`Sending BCP "${message.message}"${target === undefined ? " to room" : ` to #${target}`}`);
    ServerSend("ChatRoomChat", {
        Type: "Hidden",
        Content: "BCP",
        Dictionary: message,
        Target: target,
    } as unknown as ServerChatRoomMessage);
}

/** Sends an action-style message visible in chat, to the room or one character. */
export function SendAction(content: string, target?: Character, dictionary: ChatMessageDictionary = []): void {
    // The activity lookup for "BCPAction" intentionally misses; the dictionary
    // entry's Tag matches BC's missing-text fallback exactly, so our Text is
    // substituted in as the whole rendered message.
    ServerSend("ChatRoomChat", {
        Content: "BCPAction",
        Type: "Activity",
        Dictionary: [{
            Tag: `MISSING TEXT IN "ActivityDictionary.csv": BCPAction`,
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

/** HTML-escapes a string so it renders as plain text in the notify sinks below. */
export function EscapeHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Formats a remote rejection reason for a notify message: ": <reason>" or a
 * bare ".". The notify sinks render innerHTML and remote strings are
 * attacker-controlled, so the reason is escaped and length-capped here -
 * every `*CommandResult` handler must go through this (or EscapeHtml) rather
 * than interpolating `content.reason` directly.
 */
export function SafeReasonSuffix(reason: unknown): string {
    return typeof reason === "string" ? `: ${EscapeHtml(reason.slice(0, 200))}` : ".";
}

/** Displays text to the local player only, in BC+'s muted purple style. */
export function NotifyPlayer(content: string, timeout?: number): void {
    const darkTheme = Player.ChatSettings?.ColorTheme === "Dark" || Player.ChatSettings?.ColorTheme === "Dark2";
    const background = darkTheme ? "#3b2e52" : "#e9e2f6";
    const color = darkTheme ? "#f2eefa" : "#2c2140";
    ChatRoomSendLocal(
        `<p style='background-color:${background};color:${color};border-left:3px solid #8469b6;`
        + `padding:2px 6px;margin-bottom:0.25em;margin-top:0'>${content}</p>`,
        timeout,
    );
}

/** Displays text to the local player, marked as coming from BC+. */
export function BCPNotifyPlayer(content: string, timeout?: number): void {
    NotifyPlayer(`BC+: ${content}`, timeout);
}

/**
 * Multi-line local notice in the boxed style update messages use: every line
 * is its own chat row with a bold [BC+] prefix and italic text, in BC+'s
 * purple scheme. Lines may contain HTML (links). Room-only - ChatRoomSendLocal
 * no-ops elsewhere, so callers must handle the out-of-room case themselves.
 */
export function BCPNotifyLines(lines: string[], timeout?: number): void {
    const darkTheme = Player.ChatSettings?.ColorTheme === "Dark" || Player.ChatSettings?.ColorTheme === "Dark2";
    const background = darkTheme ? "#2a2038" : "#efe9f8";
    const color = darkTheme ? "#e8e2f0" : "#2c2140";
    for (const line of lines) {
        ChatRoomSendLocal(
            `<p style='background-color:${background};color:${color};`
            + "border:1px solid #8469b6;border-left:4px solid #8469b6;"
            + "padding:3px 8px;margin-top:0.15em;margin-bottom:0.15em;font-style:italic'>"
            + `<span style='color:#b794e6;font-weight:bold;font-style:normal'>[BC+]</span> ${line}</p>`,
            timeout,
        );
    }
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
    // Offline and not a friend: fall back to the persistent member cache
    return inRoom?.Name ?? knownMember(member)?.name ?? notFound;
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

/** Registered listener descriptions, for diagnostics (/bcp debug). */
export function ListSyncListeners(): string[] {
    return syncListeners.map((l) => `${l.owner}: ${l.message}`);
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
