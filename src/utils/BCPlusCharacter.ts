import { BCPLUS_VERSION } from "@/system/Constants";
import { debug } from "@/system/Console";

/** Wraps a BC Character with BC+-specific state and helpers. */
export class BCPlusCharacter {

    /** BC+ version this character runs, or null if none detected. */
    BCPVersion: string | null = null;

    /** Public module data received from this character via DataSync, keyed by module slug. */
    BCPData: Record<string, Record<string, unknown>> | null = null;

    private character: Character;

    constructor(character: Character) {
        this.character = character;
        if (character.ID === 0) {
            this.BCPVersion = BCPLUS_VERSION;
        }
        debug(`Loaded character ${this.toNicknamedString()}`);
    }

    get Character(): Character {
        return this.character;
    }

    /**
     * @internal BC recreates Character objects on room syncs; the cache
     * re-points wrappers at the fresh object so BC+ state (version, synced
     * data) survives instead of being lost with the stale reference.
     */
    updateCharacter(character: Character): void {
        this.character = character;
    }

    isPlayer(): boolean {
        return this.Character.IsPlayer();
    }

    get MemberNumber(): number {
        if (typeof this.Character.MemberNumber !== "number") {
            throw new Error("Selected character does not have a member number");
        }
        return this.Character.MemberNumber;
    }

    get Name(): string {
        return this.Character.Name;
    }

    get Nickname(): string {
        return this.Character.Nickname || this.Character.Name;
    }

    toString(): string {
        return `${this.Name} (${this.MemberNumber})`;
    }

    toNicknamedString(): string {
        return `${this.Nickname} (${this.MemberNumber})`;
    }

    hasAccessToPlayer(): boolean {
        return ServerChatRoomGetAllowItem(this.Character, Player);
    }

    playerHasAccessToCharacter(): boolean {
        return ServerChatRoomGetAllowItem(Player, this.Character);
    }
}

export class BCPlusPlayerCharacter extends BCPlusCharacter {
    override isPlayer(): boolean {
        return true;
    }
}

/**
 * One wrapper per member for the whole session: open screens and access
 * layers capture wrapper references, so a leave/rejoin/relog must land
 * fresh sync data on the SAME instance they hold - evicting on departure
 * orphaned every open remote view against a frozen mirror.
 * getChatroomCharacter still returns null while the member is absent (the
 * departed-target guards rely on that); the wrapper is simply reused, and
 * re-pointed at BC's fresh Character object, when they come back.
 */
const knownCharacters = new Map<number, BCPlusCharacter>();
const KNOWN_CHARACTERS_MAX = 150;
let playerWrapper: BCPlusPlayerCharacter | null = null;

/** Bounds the cache: absent members only, oldest-known first. */
function trimKnownCharacters(): void {
    if (knownCharacters.size <= KNOWN_CHARACTERS_MAX) {
        return;
    }
    for (const [member, wrapper] of knownCharacters) {
        if (knownCharacters.size <= KNOWN_CHARACTERS_MAX) {
            return;
        }
        if (!wrapper.isPlayer() && !ChatRoomCharacter.some((c) => c.MemberNumber === member)) {
            knownCharacters.delete(member);
        }
    }
}

export function getChatroomCharacter(memberNumber: number): BCPlusCharacter | null {
    if (typeof memberNumber !== "number") {
        return null;
    }
    if (Player.MemberNumber === memberNumber) {
        return getPlayerCharacter();
    }
    const bcCharacter = ChatRoomCharacter.find((c) => c.MemberNumber === memberNumber);
    if (!bcCharacter) {
        return null;
    }
    let wrapper = knownCharacters.get(memberNumber);
    if (!wrapper) {
        wrapper = new BCPlusCharacter(bcCharacter);
        knownCharacters.set(memberNumber, wrapper);
        trimKnownCharacters();
    } else if (wrapper.Character !== bcCharacter) {
        // BC recreates Character objects on syncs; keep BC+ state attached
        wrapper.updateCharacter(bcCharacter);
    }
    return wrapper;
}

export function getAllCharactersInRoom(): BCPlusCharacter[] {
    if (!ServerPlayerIsInChatRoom()) {
        return [getPlayerCharacter()];
    }
    return ChatRoomCharacter
        .map((c) => (typeof c.MemberNumber === "number" ? getChatroomCharacter(c.MemberNumber) : null))
        .filter((c): c is BCPlusCharacter => c !== null);
}

export function getPlayerCharacter(): BCPlusPlayerCharacter {
    playerWrapper ??= new BCPlusPlayerCharacter(Player);
    return playerWrapper;
}
