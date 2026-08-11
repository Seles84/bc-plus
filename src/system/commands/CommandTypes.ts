import { GetLineTask, SetLineTask } from "@/system/commands/LineTask";
import { MovePlayerToRoom } from "@/utils/BCUtils";
import { BCPNotifyPlayer } from "@/utils/Messaging";

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

function arousalMeterCheck(): true | string {
    const active = Player.ArousalSettings?.Active;
    return active === "Manual" || active === "Hybrid" || active === "Automatic"
        ? true
        : "The player's arousal meter is disabled";
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
    {
        id: "gotoRoom",
        name: "Go to room",
        description: "Sends the player to the named room: they leave their current room and join it. "
            + "If the room is full or does not exist, they end up in the room search.",
        argument: { label: "Room name:", maxChars: 30 },
        execute(argument, senderName) {
            const roomName = argument.trim();
            if (roomName.length === 0) {
                return "No room name given";
            }
            if (ServerPlayerIsInChatRoom() && ChatRoomData?.Name?.toLocaleLowerCase() === roomName.toLocaleLowerCase()) {
                return "Already in that room";
            }
            BCPNotifyPlayer(`${senderName} sends you to the room "${roomName}".`);
            void MovePlayerToRoom(roomName);
            return true;
        },
    },
    {
        id: "lines",
        name: "Write lines",
        description: "Assigns lines the player must type in chat, e.g. \"10 I will behave\" for ten "
            + "repetitions (max 50). Progress is tracked, completion is announced in the room, and "
            + "the task survives reloads. \"stop\" cancels it.",
        argument: { label: "Count + sentence:", maxChars: 160 },
        execute(argument, senderName) {
            const trimmed = argument.trim();
            if (/^(stop|clear|cancel)$/i.test(trimmed)) {
                if (GetLineTask() === null) {
                    return "No lines are assigned";
                }
                SetLineTask(null);
                BCPNotifyPlayer(`${senderName} cancelled your lines.`);
                return true;
            }
            const match = /^(\d+)\s+(\S[\s\S]*)$/.exec(trimmed);
            const count = match ? Number.parseInt(match[1]!, 10) : NaN;
            if (!match || !Number.isInteger(count) || count < 1 || count > 50) {
                return "Format: <count 1-50> <sentence>, or stop";
            }
            const sentence = sanitizeSpeech(match[2]!).slice(0, 120);
            if (sentence.length === 0) {
                return "No sentence given";
            }
            SetLineTask({ sentence, remaining: count, total: count, assigner: senderName });
            BCPNotifyPlayer(`${senderName} assigned you lines: write "${sentence}" in chat ${count} time${count === 1 ? "" : "s"}.`);
            return true;
        },
    },
    {
        id: "edge",
        name: "Edge",
        description: "Pushes the player's arousal right to the edge of orgasm.",
        execute() {
            const check = arousalMeterCheck();
            if (check !== true) {
                return check;
            }
            ActivitySetArousal(Player, 95);
            return true;
        },
    },
    {
        id: "orgasm",
        name: "Force orgasm",
        description: "Forces an orgasm on the player - they still get the chance to resist it.",
        execute() {
            const check = arousalMeterCheck();
            if (check !== true) {
                return check;
            }
            ActivitySetArousal(Player, 99);
            ActivityOrgasmPrepare(Player);
            return true;
        },
    },
    {
        id: "calm",
        name: "Calm down",
        description: "Resets the player's arousal back to zero.",
        execute() {
            const check = arousalMeterCheck();
            if (check !== true) {
                return check;
            }
            ActivitySetArousal(Player, 0);
            return true;
        },
    },
];
