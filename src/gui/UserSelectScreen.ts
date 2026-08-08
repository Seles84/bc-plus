import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { ButtonActionWidget } from "@/system/gui/Widgets";
import { getAllCharactersInRoom } from "@/utils/BCPlusCharacter";
import type { ModuleInstance } from "@/system/module/ModuleInstance";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";

interface UserCandidate {
    memberNumber: number;
    name: string;
    /** Where this candidate comes from (relationship, room, friend list) */
    note: string;
}

const PER_PAGE = 8;

/**
 * Member picker: browse people from your relationships, the current room
 * (respecting blindness settings) and your friend list instead of typing
 * member numbers. Selecting calls back and returns to the previous screen.
 */
export class UserSelectScreen extends GUIScreen {

    constructor(
        module: ModuleInstance,
        character: BCPlusCharacter | null,
        private readonly onSelect: (memberNumber: number) => void,
        private readonly excluded: number[] = [],
    ) {
        super(module, character);
    }

    get Title(): string {
        return "Select a member";
    }

    protected buildPages(): GUIPage[] {
        const candidates = this.collectCandidates();
        const pages: GUIPage[] = [];
        for (let i = 0; i < Math.max(1, Math.ceil(candidates.length / PER_PAGE)); i++) {
            pages.push(new UserSelectPage(this, candidates.slice(i * PER_PAGE, (i + 1) * PER_PAGE)));
        }
        return pages;
    }

    /** @internal */
    select(memberNumber: number): void {
        this.onSelect(memberNumber);
        this.exit();
    }

    private collectCandidates(): UserCandidate[] {
        const result = new Map<number, UserCandidate>();
        const add = (memberNumber: number, name: string, note: string): void => {
            if (memberNumber === Player.MemberNumber || this.excluded.includes(memberNumber) || result.has(memberNumber)) {
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
}

class UserSelectPage extends GUIPage {

    constructor(protected override readonly screen: UserSelectScreen, private readonly candidates: UserCandidate[]) {
        super(screen);
    }

    get Config(): PageOptions {
        return {
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: "Pick a member from your relationships, the current room, or your friend list. "
                + "Use the back button to cancel.",
        };
    }

    render(): void {
        if (this.candidates.length === 0) {
            DrawText("Nobody available to select.", 150, 250, "Gray");
            return;
        }

        DrawText("Name", 165, 200, "Gray");
        DrawText("Member #", 800, 200, "Gray");
        DrawText("From", 1050, 200, "Gray");

        this.candidates.forEach((candidate, i) => {
            const y = 230 + i * 85;
            this.addClickHandler(ButtonActionWidget(
                { Left: 150, Top: y, Width: 1300, Height: 70 },
                { Name: "", HoverText: `Select ${candidate.name} (#${candidate.memberNumber})` },
                () => this.screen.select(candidate.memberNumber),
            ));
            DrawText(candidate.name, 180, y + 35, "Black");
            DrawText(`#${candidate.memberNumber}`, 800, y + 35, "Black");
            DrawText(candidate.note, 1050, y + 35, "Gray");
        });
    }
}
