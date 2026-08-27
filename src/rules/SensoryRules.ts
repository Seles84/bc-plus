import { RuleDefinition } from "@/system/rules/RuleTypes";
import { membersValue } from "@/system/gui/Settings";

/**
 * Sensory rules impact hearing/sight the same way BC's own items do, by
 * adjusting the game's deaf/blind levels - BC then applies its native
 * garbling and view effects. The whitelists carve out exceptions for
 * specific people via scoped bypass flags.
 */

export const SensoryDepSound: RuleDefinition = {
    id: "sensory.sound",
    name: "Sensory deprivation: Sound",
    description: "Impacts the player's natural hearing the same way items do, independent of them. "
        + "Strength is adjustable; stacks with worn items.",
    category: "Sensory",
    bcxEquivalent: "alt_restrict_hearing",
    settings: [{
        type: "option",
        name: "strength",
        label: "Hearing impairment",
        options: ["Light", "Medium", "Heavy"],
        default: "Light",
    }],
    load(ctx) {
        const strengthMap: Record<string, number> = { Light: 1, Medium: 2, Heavy: 4 };
        ctx.hook("Player.GetDeafLevel", 1, (args, next) => {
            let level = next(args);
            if (ctx.isEnforced()) {
                level += strengthMap[ctx.setting<string>("strength")] ?? 0;
            }
            return level;
        });
    },
};

export const HearingWhitelist: RuleDefinition = {
    id: "sensory.hearingWhitelist",
    name: "Hearing whitelist",
    description: "The listed members are always understood clearly, no matter how deafened the "
        + "player is (by items or rules). Optionally even when those members are gagged.",
    category: "Sensory",
    bcxEquivalent: "alt_hearing_whitelist",
    settings: [
        {
            type: "members",
            name: "members",
            label: "Members always heard:",
            default: [],
        },
        {
            type: "checkbox",
            name: "includeGagged",
            label: "Understand them even while they are gagged",
            hoverText: "Gag garbling happens on the speaker's client, so this only works "
                + "when their message carries the ungarbled original alongside it.",
            default: false,
        },
    ],
    load(ctx) {
        let bypassDeaf = false;
        const whitelisted = (member: number | null | undefined): boolean =>
            typeof member === "number"
            && member !== Player.MemberNumber
            && membersValue(ctx.setting<unknown>("members")).includes(member);

        ctx.hook("ChatRoomMessage", 9, (args, next) => {
            const data = args[0] as (ServerChatRoomMessage & { OriginalMsg?: string }) | undefined;
            if (ctx.isEnforced() && data && whitelisted(data.Sender)) {
                bypassDeaf = true;
                // Gag bypass: since R131 garbling happens on the SPEAKER's
                // client (SpeechGarble on the receive path is dead), the
                // clear text is only recoverable when the message carries
                // the ungarbled original alongside the garbled Content
                if (ctx.setting<boolean>("includeGagged")
                    && (data.Type === "Chat" || data.Type === "Whisper")
                    && typeof data.OriginalMsg === "string") {
                    data.Content = data.OriginalMsg;
                }
            }
            try {
                return next(args);
            } finally {
                bypassDeaf = false;
            }
        });
        ctx.hook("Player.GetDeafLevel", 9, (args, next) => (bypassDeaf ? 0 : next(args)));
    },
};

export const SensoryDepSight: RuleDefinition = {
    id: "sensory.sight",
    name: "Sensory deprivation: Sight",
    description: "Impacts the player's natural eyesight the same way items do, independent of them. "
        + "Strength is adjustable; stacks with worn items.",
    category: "Sensory",
    bcxEquivalent: "alt_restrict_sight",
    settings: [{
        type: "option",
        name: "strength",
        label: "Eyesight impairment",
        options: ["Light", "Medium", "Heavy"],
        default: "Light",
    }],
    load(ctx) {
        const strengthMap: Record<string, number> = { Light: 1, Medium: 2, Heavy: 3 };
        ctx.hook("Player.GetBlindLevel", 1, (args, next) => {
            let level = next(args);
            if (ctx.isEnforced()) {
                level += strengthMap[ctx.setting<string>("strength")] ?? 0;
            }
            // Respect BC's "light sensory deprivation" gameplay setting cap
            return Math.min(level, Player.GameplaySettings?.SensDepChatLog === "SensDepLight" ? 2 : 3);
        });
    },
};

export const SeeingWhitelist: RuleDefinition = {
    id: "sensory.seeingWhitelist",
    name: "Seeing whitelist",
    description: "The listed members are always seen normally, no matter how blinded the player "
        + "is (by items or rules).",
    category: "Sensory",
    bcxEquivalent: "alt_seeing_whitelist",
    settings: [{
        type: "members",
        name: "members",
        label: "Members always seen:",
        default: [],
    }],
    load(ctx) {
        let bypassBlind = false;
        const whitelisted = (member: number | null | undefined): boolean =>
            typeof member === "number" && membersValue(ctx.setting<unknown>("members")).includes(member);

        const bypassFor = (member: number | null | undefined, args: unknown[], next: (a: never) => unknown): unknown => {
            if (ctx.isEnforced() && whitelisted(member)) {
                bypassBlind = true;
            }
            // finally: a throw below must not leave the bypass latched on
            try {
                return next(args as never);
            } finally {
                bypassBlind = false;
            }
        };

        ctx.hook("DrawCharacter", 0, (args, next) => bypassFor(args[0]?.MemberNumber, args, next) as void);
        ctx.hook("DialogMenuButtonBuild", 0, (args, next) => bypassFor(args[0]?.MemberNumber, args, next) as void);
        ctx.hook("ChatRoomCharacterViewClickCharacter", 0, (args, next) => bypassFor(args[0]?.MemberNumber, args, next) as void);
        ctx.hook("ChatRoomMessage", 0, (args, next) => bypassFor(args[0]?.Sender, args, next) as void);
        ctx.hook("Player.GetBlindLevel", 6, (args, next) => (bypassBlind ? 0 : next(args)));

        // While blinded, BC collapses the room view to just the player -
        // re-add whitelisted characters to the draw list
        ctx.hook("ChatRoomUpdateDisplay", 0, (args, next) => {
            const result = next(args);
            if (ctx.isEnforced()) {
                const members = membersValue(ctx.setting<unknown>("members"));
                if (members.length > 0 && ChatRoomCharacterViewCharacterCount === 1) {
                    ChatRoomCharacterDrawlist = [Player];
                }
                let added = false;
                for (const character of ChatRoomCharacter) {
                    if (typeof character.MemberNumber === "number"
                        && !ChatRoomCharacterDrawlist.includes(character)
                        && members.includes(character.MemberNumber)) {
                        ChatRoomCharacterDrawlist.push(character);
                        added = true;
                    }
                }
                if (added) {
                    ChatRoomSenseDepBypass = true;
                    ChatRoomCharacterDrawlist.sort((a, b) => ChatRoomCharacter.indexOf(a) - ChatRoomCharacter.indexOf(b));
                    ChatRoomCharacterViewCharacterCount = ChatRoomCharacterDrawlist.length;
                }
            }
            return result;
        });
    },
};
