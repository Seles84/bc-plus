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

const currentRoomCharacters: BCPlusCharacter[] = [];

/**
 * Evicts wrappers for members no longer in the room, and re-points surviving
 * wrappers at BC's current Character objects (BC recreates them on syncs -
 * matching by object identity would constantly lose BC+ state).
 */
function cleanOldCharacters(): void {
    for (let i = currentRoomCharacters.length - 1; i >= 0; i--) {
        const wrapper = currentRoomCharacters[i]!;
        if (wrapper.isPlayer()) {
            continue;
        }
        const fresh = ChatRoomCharacter.find((c) => c.MemberNumber === wrapper.Character.MemberNumber);
        if (!fresh) {
            currentRoomCharacters.splice(i, 1);
        } else if (fresh !== wrapper.Character) {
            wrapper.updateCharacter(fresh);
        }
    }
}

export function getChatroomCharacter(memberNumber: number): BCPlusCharacter | null {
    if (typeof memberNumber !== "number") {
        return null;
    }
    cleanOldCharacters();
    let character = currentRoomCharacters.find((c) => c.Character.MemberNumber === memberNumber);
    if (!character) {
        if (Player.MemberNumber === memberNumber) {
            character = new BCPlusPlayerCharacter(Player);
        } else {
            const bcCharacter = ChatRoomCharacter.find((c) => c.MemberNumber === memberNumber);
            if (!bcCharacter) {
                return null;
            }
            character = new BCPlusCharacter(bcCharacter);
        }
        currentRoomCharacters.push(character);
    }
    return character;
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
    let character = currentRoomCharacters.find((c) => c.Character === Player) as BCPlusPlayerCharacter | undefined;
    if (!character) {
        character = new BCPlusPlayerCharacter(Player);
        currentRoomCharacters.push(character);
    }
    return character;
}
