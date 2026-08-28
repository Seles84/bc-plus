import { RuleDefinition } from "@/system/rules/RuleTypes";
import { SendAction } from "@/utils/Messaging";
import { BCPNotifyPlayer } from "@/utils/Messaging";
import { InfoBeep, MovePlayerToRoom } from "@/utils/BCUtils";
import { debug } from "@/system/Console";
import { membersValue } from "@/system/gui/Settings";

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
        + "target room is full, they end up in the lobby. The summoner must be in a room and leave "
        + "\"attach room\" enabled when writing the beep, or it carries no room to move to.",
    category: "Other",
    bcxEquivalent: "alt_forced_summoning",
    settings: [
        {
            type: "members",
            name: "allowedMembers",
            label: "Members who may summon:",
            default: [],
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
            // Dev builds trace exactly why a message beep did not summon
            const disqualified = (reason: string): false => {
                debug(`Summon beep from #${data?.MemberNumber} ignored: ${reason}`);
                return false;
            };
            const qualifies = ((): boolean => {
                if (!data || data.BeepType || typeof data.MemberNumber !== "number" || typeof data.Message !== "string") {
                    return false; // not a plain message beep - stay quiet
                }
                if (!ctx.isEnforced()) {
                    return disqualified("rule is not enforced (or paused by its conditions)");
                }
                if (!membersValue(ctx.setting<unknown>("allowedMembers")).includes(data.MemberNumber)) {
                    return disqualified("sender is not on the allowed members list");
                }
                if (data.Message.trim().toLocaleLowerCase() !== "summon"
                    && !(summonText.length > 0 && data.Message.toLocaleLowerCase().startsWith(summonText))) {
                    return disqualified("message does not match the summon text");
                }
                // The server strips room info when the sender turned off
                // "attach room" on the beep, or is not in a room
                if (typeof data.ChatRoomName !== "string" || data.ChatRoomSpace == null) {
                    return disqualified("beep carries no room info (sender must be in a room with \"attach room\" on)");
                }
                if (!ChatSelectGendersAllowed(data.ChatRoomSpace, Player.GetGenders())) {
                    return disqualified("that room space does not allow the player's gender");
                }
                return true;
            })();

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
            // The chat notification is invisible outside rooms - the beep is not
            InfoBeep(`You are summoned by ${data!.MemberName ?? `#${summoner}`}! Moving to "${roomName}" in ${delaySeconds} seconds...`, 8000);
            BCPNotifyPlayer(`You are summoned by #${summoner}! Moving in ${delaySeconds} seconds...`);
            ctx.triggerAttempt(summoner);

            // Tracked timeout: cancelled if the rule (or the whole Rules
            // module) is switched off before the delay runs out
            ctx.timeout(() => {
                void (async () => {
                    // Still in effect, and not already there?
                    if (!ctx.isEnforced() || (ServerPlayerIsInChatRoom() && ChatRoomData?.Name === roomName)) {
                        return;
                    }
                    if (ServerPlayerIsInChatRoom()) {
                        SendAction(`The summons for ${Player.Nickname || Player.Name} is now enforced.`);
                    }
                    await MovePlayerToRoom(roomName, space);
                })();
            }, delaySeconds * 1000);
            return result;
        });
    },
};
