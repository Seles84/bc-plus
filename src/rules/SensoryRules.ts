import { RuleDefinition } from "@/system/rules/RuleTypes";

/**
 * Sensory rules impact hearing/sight the same way BC's own items do, by
 * adjusting the game's deaf/blind levels - BC then applies its native
 * garbling and view effects. The whitelists carve out exceptions for
 * specific people via scoped bypass flags.
 */

function parseMembers(raw: string): number[] {
    return raw
        .split(",")
        .map((m) => Number.parseInt(m.trim(), 10))
        .filter((m) => Number.isInteger(m) && m >= 0);
}

export const SensoryDepSound: RuleDefinition = {
    id: "sensory.sound",
    name: "Sensory deprivation: Sound",
    description: "Impacts the player's natural hearing the same way items do, independent of them. "
        + "Strength is adjustable; stacks with worn items.",
    category: "Sensory",
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
    settings: [
        {
            type: "text",
            name: "members",
            label: "Members always heard:",
            default: "",
            maxChars: 200,
        },
        {
            type: "checkbox",
            name: "includeGagged",
            label: "Understand them even while they are gagged",
            default: false,
        },
    ],
    load(ctx) {
        let bypassDeaf = false;
        const whitelisted = (member: number | null | undefined): boolean =>
            typeof member === "number"
            && member !== Player.MemberNumber
            && parseMembers(ctx.setting<string>("members")).includes(member);

        ctx.hook("SpeechGarble", 2, (args, next) => {
            const [character, text] = args;
            if (ctx.isEnforced() && whitelisted(character.MemberNumber)
                && (character.CanTalk() || ctx.setting<boolean>("includeGagged"))) {
                return text;
            }
            return next(args);
        });
        ctx.hook("ChatRoomMessage", 9, (args, next) => {
            if (ctx.isEnforced() && whitelisted(args[0]?.Sender)) {
                bypassDeaf = true;
            }
            const result = next(args);
            bypassDeaf = false;
            return result;
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
    settings: [{
        type: "text",
        name: "members",
        label: "Members always seen:",
        default: "",
        maxChars: 200,
    }],
    load(ctx) {
        let bypassBlind = false;
        const whitelisted = (member: number | null | undefined): boolean =>
            typeof member === "number" && parseMembers(ctx.setting<string>("members")).includes(member);

        const bypassFor = (member: number | null | undefined, args: unknown[], next: (a: never) => unknown): unknown => {
            if (ctx.isEnforced() && whitelisted(member)) {
                bypassBlind = true;
            }
            const result = next(args as never);
            bypassBlind = false;
            return result;
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
                const members = parseMembers(ctx.setting<string>("members"));
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
