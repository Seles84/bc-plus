import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { UserCandidate, collectMemberCandidates } from "@/gui/UserSelectScreen";
import { ElementSetVisible } from "@/utils/BCUtils";
import type { ModuleInstance } from "@/system/module/ModuleInstance";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";

/** What a members multi-select edits. */
export interface MembersTarget {
    label: string;
    get(): number[];
    set(members: number[]): void;
    canEdit(): boolean;
}

const PER_PAGE = 7;
const ADD_INPUT = "BCP_membersAdd";

/**
 * Multi-select member picker for members settings: browse relationships,
 * the current room and friends with checkboxes, or add a member number
 * directly. Changes persist immediately.
 */
export class MembersSelectScreen extends GUIScreen {

    constructor(
        module: ModuleInstance,
        character: BCPlusCharacter | null,
        readonly target: MembersTarget,
    ) {
        super(module, character);
    }

    get Title(): string {
        return `Members - ${this.target.label}`;
    }

    protected buildPages(): GUIPage[] {
        // Selected members missing from the browse sources still get a row,
        // so they can be seen and unselected
        const candidates = collectMemberCandidates();
        const known = new Set(candidates.map((c) => c.memberNumber));
        const extras = this.target.get()
            .filter((m) => !known.has(m))
            .map((memberNumber): UserCandidate => ({
                memberNumber,
                name: Player.FriendNames?.get(memberNumber) ?? `#${memberNumber}`,
                note: "Selected",
            }));
        const rows = [...extras, ...candidates];
        const pages: GUIPage[] = [];
        for (let i = 0; i < Math.max(1, Math.ceil(rows.length / PER_PAGE)); i++) {
            pages.push(new MembersSelectPage(this, rows.slice(i * PER_PAGE, (i + 1) * PER_PAGE)));
        }
        return pages;
    }
}

class MembersSelectPage extends GUIPage {

    constructor(protected override readonly screen: MembersSelectScreen, private readonly rows: UserCandidate[]) {
        super(screen);
    }

    get Config(): PageOptions {
        return {
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: "Tick everyone this setting should apply to - from your relationships, the "
                + "current room, or your friend list - or type a member number and click Add. "
                + "Changes are saved immediately; use the back button when done.",
        };
    }

    private get target(): MembersTarget {
        return this.screen.target;
    }

    override async create(): Promise<void> {
        ElementCreateInput(ADD_INPUT, "text", "", "10");
    }

    override async destroy(): Promise<void> {
        ElementRemove(ADD_INPUT);
    }

    render(): void {
        const selected = this.target.get();
        const canEdit = this.target.canEdit();

        MainCanvas.textAlign = "left";
        DrawText(`${selected.length} selected`, 1500, 200, "Gray");

        if (this.rows.length === 0) {
            DrawText("Nobody to browse - add member numbers below.", 150, 250, "Gray");
        }

        this.rows.forEach((candidate, i) => {
            const y = 230 + i * 85;
            const checked = selected.includes(candidate.memberNumber);
            DrawCheckbox(150, y, 64, 64, "", checked, !canEdit);
            DrawText(candidate.name, 260, y + 35, "Black");
            DrawText(`#${candidate.memberNumber}`, 800, y + 35, "Black");
            DrawText(candidate.note, 1050, y + 35, "Gray");
            this.addClickHandler(() => {
                if (canEdit && MouseIn(150, y, 64, 64)) {
                    this.target.set(checked
                        ? selected.filter((m) => m !== candidate.memberNumber)
                        : [...selected, candidate.memberNumber]);
                }
            });
        });

        // Manual entry for members not in any browse source
        ElementSetVisible(ADD_INPUT, !this.Screen.HelpVisible);
        DrawText("Member number:", 150, 880, "Black");
        ElementPosition(ADD_INPUT, 650, 875, 400, 60);
        const input = document.getElementById(ADD_INPUT) as HTMLInputElement | null;
        if (input) {
            input.disabled = !canEdit;
        }
        MainCanvas.textAlign = "center";
        DrawButton(890, 845, 160, 64, "Add", canEdit ? "White" : "#ddd", "", "", !canEdit);
        this.addClickHandler(() => {
            if (!canEdit || !MouseIn(890, 845, 160, 64) || !input) {
                return;
            }
            const memberNumber = Number.parseInt(input.value.trim(), 10);
            if (Number.isInteger(memberNumber) && memberNumber >= 0 && !selected.includes(memberNumber)) {
                this.target.set([...selected, memberNumber]);
                input.value = "";
                this.Screen.reopen();
            }
        });
    }
}
