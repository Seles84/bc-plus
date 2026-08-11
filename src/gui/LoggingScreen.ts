import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { LogEntry, formatLogTime } from "@/system/logging/LogTypes";
import { ButtonActionWidget } from "@/system/gui/Widgets";
import { modalConfirm, modalPrompt } from "@/gui/Modal";
import { ModuleSettingsScreen } from "@/gui/ModuleSettings";
import { SendBCPMessage } from "@/utils/Messaging";
import type Authority from "@/modules/Authority";
import type Logging from "@/modules/Logging";
import type { GUI } from "@/modules/GUI";

const PER_PAGE = 10;

export class LoggingScreen extends GUIScreen {

    get Title(): string {
        return this.Character && !this.Character.isPlayer()
            ? `Log - ${this.Character.Nickname}`
            : "Behavior Log";
    }

    private get logging(): Logging {
        return this.Module as Logging;
    }

    private get remote(): boolean {
        return this.Character !== null && !this.Character.isPlayer();
    }

    protected buildPages(): GUIPage[] {
        if (this.remote) {
            const fetched = this.logging.getRemoteLog(this.Character!.MemberNumber);
            const entries = Array.isArray(fetched) ? fetched : [];
            return this.paginate(entries);
        }
        if (!this.logging.canView()) {
            return [new LogPage(this, [], "You are not permitted to view your own log.")];
        }
        return this.paginate(this.logging.Entries);
    }

    private paginate(entries: LogEntry[]): GUIPage[] {
        const newestFirst = [...entries].reverse();
        const pages: GUIPage[] = [];
        for (let i = 0; i < Math.max(1, Math.ceil(newestFirst.length / PER_PAGE)); i++) {
            pages.push(new LogPage(this, newestFirst.slice(i * PER_PAGE, (i + 1) * PER_PAGE), null));
        }
        return pages;
    }
}

class LogPage extends GUIPage {

    private removeListener: (() => void) | null = null;

    constructor(
        protected override readonly screen: LoggingScreen,
        private readonly entries: LogEntry[],
        private readonly notice: string | null,
    ) {
        super(screen);
    }

    private get logging(): Logging {
        return this.screen.Module as Logging;
    }

    get Config(): PageOptions {
        return {
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: this.logging.Config.HoverText,
        };
    }

    override async create(): Promise<void> {
        const character = this.Character;
        if (character && !character.isPlayer() && this.logging.getRemoteLog(character.MemberNumber) === undefined) {
            this.logging.requestLog(character.MemberNumber);
            // Rebuild the screen once the response lands
            this.removeListener = this.Core.Events.on("logReceived", ({ memberNumber }) => {
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
        const character = this.Character;

        if (this.notice) {
            DrawText(this.notice, 150, 250, "Gray");
            return;
        }

        if (character && !character.isPlayer()) {
            const fetched = this.logging.getRemoteLog(character.MemberNumber);
            if (fetched === undefined || fetched === "pending") {
                DrawText("Requesting log...", 150, 250, "Gray");
                return;
            }
            if (fetched === "denied") {
                DrawText(`${character.Nickname} does not permit you to view their log.`, 150, 250, "Gray");
                return;
            }
            if (fetched === "timeout") {
                DrawText("No response - they may be busy, disconnected, or running an older BC+.", 150, 250, "Gray");
                return;
            }
        }

        // Own view: recording configuration (visible even when the log is empty)
        if (!character || character.isPlayer()) {
            MainCanvas.textAlign = "center";
            this.addClickHandler(ButtonActionWidget(
                { Left: 490, Top: 880, Width: 300, Height: 70 },
                { Name: "Configure...", HoverText: "Choose which categories your log records (needs log.configure)" },
                () => {
                    this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(
                        new ModuleSettingsScreen(this.logging, this.Character),
                    );
                },
            ));
            MainCanvas.textAlign = "left";
        }

        if (this.entries.length === 0) {
            DrawText("The log is empty.", 150, 250, "Gray");
            return;
        }

        this.entries.forEach((entry, i) => {
            const y = 220 + i * 70;
            DrawText(formatLogTime(entry.time), 150, y + 24, "Gray");
            DrawText(`[${entry.category}]`, 420, y + 24, "Gray");
            DrawTextFit(entry.message, 560, y + 24, 1240, "Black");
        });

        if (!character || character.isPlayer()) {
            if (this.logging.canClear() && this.logging.Entries.length > 0) {
                MainCanvas.textAlign = "center";
                this.addClickHandler(ButtonActionWidget(
                    { Left: 150, Top: 880, Width: 300, Height: 70 },
                    { Name: "Clear log", HoverText: "Removes all entries" },
                    () => {
                        this.logging.clear();
                        this.screen.reopen();
                    },
                ));
                MainCanvas.textAlign = "left";
            }
            return;
        }

        // Praise / scold / note on someone else's log (their client validates)
        const authority = this.Core.ModuleManager.getModule<Authority>("authority");
        const canPraise = authority?.remoteHasPermission(character, "log.praise") ?? false;
        const canNote = authority?.remoteHasPermission(character, "log.note") ?? false;
        MainCanvas.textAlign = "center";
        this.addClickHandler(ButtonActionWidget(
            { Left: 150, Top: 880, Width: 220, Height: 70 },
            { Name: "Praise", Active: canPraise, HoverText: "Add a praise entry to their log" },
            () => this.sendEntry(character.MemberNumber, "praise", "Add a message to the praise (optional):", true),
        ));
        this.addClickHandler(ButtonActionWidget(
            { Left: 390, Top: 880, Width: 220, Height: 70 },
            { Name: "Scold", Active: canPraise, HoverText: "Add a scold entry to their log" },
            () => this.sendEntry(character.MemberNumber, "scold", "Add a message to the scolding (optional):", true),
        ));
        this.addClickHandler(ButtonActionWidget(
            { Left: 630, Top: 880, Width: 260, Height: 70 },
            { Name: "Leave note", Active: canNote, HoverText: "Attach a note to their log" },
            () => this.sendEntry(character.MemberNumber, "note", "Note text:", false),
        ));
        const canClear = authority?.remoteHasPermission(character, "log.delete") ?? false;
        this.addClickHandler(ButtonActionWidget(
            { Left: 1450, Top: 880, Width: 300, Height: 70 },
            { Name: "Clear log", Active: canClear, HoverText: "Removes all entries from their log (their client validates)" },
            () => {
                void modalConfirm(`Clear ${character.Nickname}'s entire behavior log?`, true).then((confirmed) => {
                    if (confirmed) {
                        this.logging.requestClear(character.MemberNumber);
                    }
                });
            },
        ));
        MainCanvas.textAlign = "left";
    }

    private sendEntry(memberNumber: number, kind: string, promptText: string, optional: boolean): void {
        void modalPrompt(promptText, "", 200).then((text) => {
            if (text === null || (!optional && text.trim().length === 0)) {
                return;
            }
            SendBCPMessage({ message: "LogAdd", kind, text: text.trim() }, memberNumber);
        });
    }
}
