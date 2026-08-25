import { getAllCharactersInRoom } from "@/utils/BCPlusCharacter";

export interface UserCandidate {
    memberNumber: number;
    name: string;
    /** Where this candidate comes from (relationship, room, friend list) */
    note: string;
}

/**
 * People the player can browse: their BC relationships, the current room
 * (respecting blindness settings) and their friend list.
 */
export function collectMemberCandidates(excluded: number[] = []): UserCandidate[] {
    const result = new Map<number, UserCandidate>();
    const add = (memberNumber: number, name: string, note: string): void => {
        if (memberNumber === Player.MemberNumber || excluded.includes(memberNumber) || result.has(memberNumber)) {
            return;
        }
        result.set(memberNumber, { memberNumber, name, note });
    };

    // The player's own BC relationships first
    if (Player.Ownership && typeof Player.Ownership.MemberNumber === "number") {
        add(Player.Ownership.MemberNumber, Player.Ownership.Name, "Your BC Owner");
    }
    for (const lover of Player.Lovership ?? []) {
        if (typeof lover.MemberNumber === "number") {
            add(lover.MemberNumber, lover.Name, "Your Lover");
        }
    }

    // Room members, respecting blindness settings (mirrors BC's examine rules)
    if (Player.GetBlindLevel() < 3 || !Player.GameplaySettings?.BlindDisableExamine) {
        const roomCharacters = getAllCharactersInRoom();
        const restrictToAdjacent = Player.GetBlindLevel() > 0 && Player.ImmersionSettings?.BlindAdjacent;
        const playerIndex = roomCharacters.findIndex((c) => c.isPlayer());
        roomCharacters.forEach((character, i) => {
            if (restrictToAdjacent && Math.abs(i - playerIndex) !== 1) {
                return;
            }
            add(character.MemberNumber, character.Name, "In this room");
        });
    }

    // Friends
    for (const [memberNumber, name] of Player.FriendNames?.entries() ?? []) {
        add(memberNumber, name, "Friend");
    }

    return [...result.values()];
}
