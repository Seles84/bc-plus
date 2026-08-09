import { RuleDefinition } from "@/system/rules/RuleTypes";
import { SendAction } from "@/utils/Messaging";
import { BCPNotifyPlayer } from "@/utils/Messaging";

function parseMembers(raw: string): number[] {
    return raw
        .split(",")
        .map((m) => Number.parseInt(m.trim(), 10))
        .filter((m) => Number.isInteger(m) && m >= 0);
}

/**
 * Allows configured members to summon the player from anywhere in the club
 * by sending a beep whose message starts with the summon text (or "summon").
 * After the delay, the player is moved to the summoner's room.
 */
export const ReadyToBeSummoned: RuleDefinition = {
    id: "other.summon",
    name: "Ready to be summoned",
    description: "Configured members can summon the player from anywhere in the club with a beep "
        + "whose message starts with the summon text (or just \"summon\"). After the delay, the "
        + "player is pulled to the summoner's room - ignoring leashes and locked doors. If the "
        + "target room is full, they end up in the lobby.",
    category: "Other",
    settings: [
        {
            type: "text",
            name: "allowedMembers",
            label: "Members who may summon:",
            default: "",
            maxChars: 200,
        },
        {
            type: "text",
            name: "summonText",
            label: "Summon text:",
            default: "Come to my room immediately",
            maxChars: 100,
        },
        {
            type: "option",
            name: "delay",
            label: "Seconds before enforcing",
            options: ["10", "15", "30", "60"],
            default: "15",
        },
    ],
    load(ctx) {
        ctx.hook("ServerAccountBeep", 7, (args, next) => {
            const data = args[0] as Partial<ServerAccountBeepResponse> | undefined;
            const summonText = ctx.setting<string>("summonText").trim().toLocaleLowerCase();
            const qualifies = data
                && !data.BeepType
                && typeof data.MemberNumber === "number"
                && ctx.isEnforced()
                && parseMembers(ctx.setting<string>("allowedMembers")).includes(data.MemberNumber)
                && typeof data.Message === "string"
                && (data.Message.trim().toLocaleLowerCase() === "summon"
                    || (summonText.length > 0 && data.Message.toLocaleLowerCase().startsWith(summonText)))
                && typeof data.ChatRoomName === "string"
                && data.ChatRoomSpace !== undefined
                && ChatSelectGendersAllowed(data.ChatRoomSpace, Player.GetGenders());

            const result = next(args);
            if (!qualifies) {
                return result;
            }

            const roomName = data!.ChatRoomName!;
            const space = data!.ChatRoomSpace!;
            const summoner = data!.MemberNumber!;
            const delaySeconds = Number.parseInt(ctx.setting<string>("delay"), 10);

            if (ServerPlayerIsInChatRoom()) {
                SendAction(`${Player.Nickname || Player.Name} has received a summons and must obey.`);
            }
            BCPNotifyPlayer(`You are summoned by #${summoner}! Moving in ${delaySeconds} seconds...`);
            ctx.triggerAttempt(summoner);

            setTimeout(() => {
                void (async () => {
                    // Still in effect, and not already there?
                    if (!ctx.isEnforced() || (ServerPlayerIsInChatRoom() && ChatRoomData?.Name === roomName)) {
                        return;
                    }
                    if (ServerPlayerIsInChatRoom()) {
                        SendAction(`The summons for ${Player.Nickname || Player.Name} is now enforced.`);
                        ChatRoomLeave(true);
                    }
                    await ChatSearchStart(space, ["Room", "MainHall"], { Background: "Introduction" });
                    // Wait for the search screen before joining
                    for (let i = 0; i < 20; i++) {
                        const screen = CommonGetScreen();
                        if (screen[0] === "Online" && screen[1] === "ChatSearch") {
                            break;
                        }
                        await new Promise((resolve) => setTimeout(resolve, 500));
                    }
                    ServerSend("ChatRoomJoin", { Name: roomName });
                })();
            }, delaySeconds * 1000);
            return result;
        });
    },
};
