import { BCPLUS_VERSION } from "@/system/Constants";
import { debug } from "@/system/Console";

/** Wraps a BC Character with BC+-specific state and helpers. */
export class BCPlusCharacter {

    /** BC+ version this character runs, or null if none detected. */
    BCPVersion: string | null = null;

    /** Public module data received from this character via DataSync, keyed by module slug. */
    BCPData: Record<string, Record<string, unknown>> | null = null;

    constructor(public readonly Character: Character) {
        if (Character.ID === 0) {
            this.BCPVersion = BCPLUS_VERSION;
        }
        debug(`Loaded character ${this.toNicknamedString()}`);
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

function cleanOldCharacters(): void {
    for (let i = currentRoomCharacters.length - 1; i >= 0; i--) {
        if (!currentRoomCharacters[i]!.isPlayer() && !ChatRoomCharacter.includes(currentRoomCharacters[i]!.Character)) {
            currentRoomCharacters.splice(i, 1);
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
