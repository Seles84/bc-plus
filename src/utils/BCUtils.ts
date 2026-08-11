/** Shows a beep-style info notification in the top-left corner of the club. */
export function InfoBeep(message: string, duration: number = 4000): void {
    ServerShowBeep(message, duration, { silent: true });
}

/**
 * Shows or hides a DOM input created via ElementCreateInput. DOM elements
 * always float above the canvas, so canvas overlays (help boxes, modals)
 * cannot cover them - they must be hidden explicitly.
 */
export function ElementSetVisible(id: string, visible: boolean): void {
    const element = document.getElementById(id);
    if (element) {
        element.style.display = visible ? "" : "none";
    }
}

/**
 * Moves the player to the named room, leaving the current one first and
 * waiting for the search screen between the steps (BCX-compatible flow).
 * If the room is full or missing, the player ends up in the room search.
 */
export async function MovePlayerToRoom(roomName: string, space?: ServerChatRoomSpace): Promise<void> {
    const targetSpace: ServerChatRoomSpace = space ?? ChatRoomData?.Space ?? "X";
    if (ServerPlayerIsInChatRoom()) {
        ChatRoomLeave(true);
    }
    await ChatSearchStart(targetSpace, ["Room", "MainHall"], { Background: "Introduction" });
    // Wait for the search screen before joining
    for (let i = 0; i < 20; i++) {
        const screen = CommonGetScreen();
        if (screen[0] === "Online" && screen[1] === "ChatSearch") {
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    ServerSend("ChatRoomJoin", { Name: roomName });
}

/**
 * Deep-clones JSON-safe data. Unlike structuredClone this works on the
 * storage auto-sync Proxy objects (structuredClone throws DataCloneError
 * on proxies); BC+ save data is JSON-safe by construction.
 */
export function jsonClone<T>(value: T): T {
    if (value === undefined || value === null) {
        return value;
    }
    return JSON.parse(JSON.stringify(value)) as T;
}
