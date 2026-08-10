import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { ButtonActionWidget } from "@/system/gui/Widgets";
import { modalConfirm, modalInfo, modalPrompt } from "@/gui/Modal";
import { MemberNumberToName } from "@/utils/Messaging";
import { NICKNAME_MAX, RelationshipEntry, isValidCustomName } from "@/modules/Relationships";
import type Relationships from "@/modules/Relationships";
import type Authority from "@/modules/Authority";

const PER_PAGE = 8;

interface RelationshipRow {
    member: number;
    entry: RelationshipEntry;
}

export class RelationshipsScreen extends GUIScreen {

    get Title(): string {
        return this.Remote ? `Relationships - ${this.Character!.Nickname}` : "Relationships";
    }

    get relationships(): Relationships {
        return this.Module as Relationships;
    }

    get Remote(): boolean {
        return this.Character !== null && !this.Character.isPlayer();
    }

    /** The entries being shown: own list, or the fetched remote list. */
    entries(): Record<string, RelationshipEntry> | null {
        if (!this.Remote) {
            return this.relationships.Entries;
        }
        const fetched = this.relationships.getRemoteEntries(this.Character!.MemberNumber);
        return typeof fetched === "object" ? fetched : null;
    }

    /** Whether the viewer may change the list being shown. */
    canEdit(): boolean {
        if (!this.Remote) {
            return this.relationships.canEdit();
        }
        const authority = this.Core.ModuleManager.getModule<Authority>("authority");
        return authority?.remoteHasPermission(this.Character!, "relationships.edit") ?? false;
    }

    protected buildPages(): GUIPage[] {
        const entries = this.entries() ?? {};
        const rows: RelationshipRow[] = Object.entries(entries)
            .map(([key, entry]) => ({ member: parseInt(key, 10), entry }))
            .filter((row) => Number.isInteger(row.member))
            .sort((a, b) => a.member - b.member);
        const pages: GUIPage[] = [];
        for (let i = 0; i < Math.max(1, Math.ceil(rows.length / PER_PAGE)); i++) {
            pages.push(new RelationshipsPage(this, rows.slice(i * PER_PAGE, (i + 1) * PER_PAGE)));
        }
        return pages;
    }
}

class RelationshipsPage extends GUIPage {

    private removeListener: (() => void) | null = null;

    constructor(
        protected override readonly screen: RelationshipsScreen,
        private readonly rows: RelationshipRow[],
    ) {
        super(screen);
    }

    private get relationships(): Relationships {
        return this.screen.relationships;
    }

    get Config(): PageOptions {
        return {
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: this.relationships.Config.HoverText
                + (this.screen.Remote ? " On someone else's list, their client validates every change." : ""),
        };
    }

    override async create(): Promise<void> {
        const character = this.Character;
        if (this.screen.Remote && character) {
            if (this.relationships.getRemoteEntries(character.MemberNumber) === undefined) {
                this.relationships.requestEntries(character.MemberNumber);
            }
            this.removeListener = this.Core.Events.on("relationshipsReceived", ({ memberNumber }) => {
                if (memberNumber === character.MemberNumber) {
                    this.screen.reopen();
                }
            });
        }
    }

    override async destroy(): Promise<void> {
        this.removeListener?.();
        this.removeListener = null;
    }

    render(): void {
        if (this.screen.Remote) {
            const fetched = this.relationships.getRemoteEntries(this.Character!.MemberNumber);
            if (fetched === undefined || fetched === "pending") {
                DrawText("Requesting their relationship list...", 150, 250, "Gray");
                return;
            }
            if (fetched === "denied") {
                DrawText(`${this.Character!.Nickname} does not permit you to view their relationships.`, 150, 250, "Gray");
                return;
            }
            if (fetched === "timeout") {
                DrawText("No response - they may be busy, disconnected, or running an older BC+.", 150, 250, "Gray");
                return;
            }
        }

        const canEdit = this.screen.canEdit();

        if (this.rows.length === 0) {
            DrawText("No custom names set.", 150, 250, "Gray");
        } else {
            DrawText("Member", 150, 194, "Gray");
            DrawText("Custom name", 720, 194, "Gray");
            DrawText("Must use it", 1270, 194, "Gray");
            this.rows.forEach((row, i) => {
                const y = 230 + i * 80;
                DrawTextFit(`${MemberNumberToName(row.member)} (#${row.member})`, 150, y + 35, 540, "Black");
                MainCanvas.textAlign = "center";
                this.addClickHandler(ButtonActionWidget(
                    { Left: 720, Top: y, Width: 480, Height: 70 },
                    { Name: row.entry.nickname, Active: canEdit, HoverText: "Change the custom name" },
                    () => this.editNickname(row),
                ));
                this.addClickHandler(ButtonActionWidget(
                    { Left: 1270, Top: y, Width: 160, Height: 70 },
                    {
                        Name: row.entry.enforce ? "Yes" : "No",
                        Active: canEdit,
                        HoverText: "Whether using their real name in chat is blocked",
                    },
                    () => this.setEntry(row.member, row.entry.nickname, !row.entry.enforce),
                ));
                this.addClickHandler(ButtonActionWidget(
                    { Left: 1500, Top: y, Width: 130, Height: 70 },
                    { Name: "X", Active: canEdit, HoverText: "Remove this custom name" },
                    () => this.removeEntry(row),
                ));
                MainCanvas.textAlign = "left";
            });
        }

        MainCanvas.textAlign = "center";
        this.addClickHandler(ButtonActionWidget(
            { Left: 150, Top: 910, Width: 340, Height: 70 },
            { Name: "Add name...", Active: canEdit, HoverText: "Set a custom name for a member" },
            () => this.addEntry(),
        ));
        MainCanvas.textAlign = "left";
    }

    private addEntry(): void {
        void (async () => {
            const raw = await modalPrompt("Member number to set a custom name for:");
            if (raw === null) {
                return;
            }
            const member = parseInt(raw.trim(), 10);
            if (!Number.isInteger(member) || member < 0 || member.toString() !== raw.trim()) {
                await modalInfo("That is not a valid member number.");
                return;
            }
            await this.promptNickname(member, "", false);
        })();
    }

    private editNickname(row: RelationshipRow): void {
        void this.promptNickname(row.member, row.entry.nickname, row.entry.enforce);
    }

    private async promptNickname(member: number, current: string, enforce: boolean): Promise<void> {
        const nickname = await modalPrompt(
            `Custom name for ${MemberNumberToName(member)} (#${member}):`, current, NICKNAME_MAX);
        if (nickname === null) {
            return;
        }
        if (!isValidCustomName(nickname.trim())) {
            await modalInfo(`"${nickname.trim()}" is not a usable name (1-${NICKNAME_MAX} characters, like a BC nickname).`);
            return;
        }
        this.setEntry(member, nickname.trim(), enforce);
    }

    private setEntry(member: number, nickname: string, enforce: boolean): void {
        if (this.screen.Remote) {
            this.relationships.requestSet(this.Character!.MemberNumber, member, nickname, enforce);
            return;
        }
        this.relationships.setEntry(member, nickname, enforce);
        this.screen.reopen();
    }

    private removeEntry(row: RelationshipRow): void {
        void modalConfirm(`Remove the custom name "${row.entry.nickname}" for ${MemberNumberToName(row.member)} (#${row.member})?`)
            .then((confirmed) => {
                if (!confirmed) {
                    return;
                }
                if (this.screen.Remote) {
                    this.relationships.requestRemove(this.Character!.MemberNumber, row.member);
                    return;
                }
                this.relationships.removeEntry(row.member);
                this.screen.reopen();
            });
    }
}
