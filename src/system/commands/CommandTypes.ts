/** A one-shot order that executes on the target's own client. */
export interface CommandDefinition {
    /** Unique id, e.g. "kneel" */
    id: string;
    name: string;
    description: string;
    /** When set, the command takes a free-text argument (validated by execute) */
    argument?: { label: string; maxChars: number };
    /**
     * Executes the command on THIS client (the target).
     * @returns true on success, or an error message
     */
    execute(argument: string, senderName: string): true | string;
}

const EMOTICONS = [
    "Afk", "Whisper", "Sleep", "Hearts", "Tear", "Hearing", "Confusion", "Exclamation",
    "Annoyed", "Read", "RaisedHand", "Spectator", "ThumbsDown", "ThumbsUp",
    "LoveRope", "LoveGag", "LoveLock", "Wardrobe", "Gaming", "Coffee", "Fork", "Music",
] as const;

function sanitizeSpeech(text: string): string {
    // No command/emote/OOC injection through forced speech
    return text.trim().replace(/^[/*(.]+/, "").slice(0, 200);
}

export const COMMAND_DEFINITIONS: readonly CommandDefinition[] = [
    {
        id: "kneel",
        name: "Kneel",
        description: "Makes the player kneel down.",
        execute() {
            PoseSetActive(Player, "Kneel", true);
            if (ServerPlayerIsInChatRoom()) {
                ChatRoomCharacterUpdate(Player);
            }
            return true;
        },
    },
    {
        id: "stand",
        name: "Stand up",
        description: "Makes the player stand back up.",
        execute() {
            PoseSetActive(Player, null, true);
            if (ServerPlayerIsInChatRoom()) {
                ChatRoomCharacterUpdate(Player);
            }
            return true;
        },
    },
    {
        id: "closeEyes",
        name: "Close eyes",
        description: "Makes the player close their eyes.",
        execute() {
            CharacterSetFacialExpression(Player, "Eyes", "Closed");
            return true;
        },
    },
    {
        id: "openEyes",
        name: "Open eyes",
        description: "Lets the player open their eyes again.",
        execute() {
            CharacterSetFacialExpression(Player, "Eyes", undefined);
            return true;
        },
    },
    {
        id: "emoticon",
        name: "Set emoticon",
        description: "Shows an emoticon over the player's head (e.g. Afk, Sleep, Hearts, Confusion, Coffee).",
        argument: { label: "Emoticon:", maxChars: 20 },
        execute(argument) {
            const match = EMOTICONS.find((e) => e.toLocaleLowerCase() === argument.trim().toLocaleLowerCase());
            if (!match) {
                return `Unknown emoticon "${argument}"`;
            }
            CharacterSetFacialExpression(Player, "Emoticon", match);
            return true;
        },
    },
    {
        id: "say",
        name: "Forced say",
        description: "The player says the given sentence in chat.",
        argument: { label: "Sentence:", maxChars: 200 },
        execute(argument) {
            const text = sanitizeSpeech(argument);
            if (text.length === 0) {
                return "Nothing to say";
            }
            if (!ServerPlayerIsInChatRoom()) {
                return "Not in a chat room";
            }
            ServerSend("ChatRoomChat", { Content: text, Type: "Chat" });
            return true;
        },
    },
];
