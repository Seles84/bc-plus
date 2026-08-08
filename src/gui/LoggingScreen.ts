import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { LogEntry, formatLogTime } from "@/system/logging/LogTypes";
import { ButtonActionWidget } from "@/system/gui/Widgets";
import type Logging from "@/modules/Logging";

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
                    { Left: 150, Top: 910, Width: 300, Height: 70 },
                    { Name: "Clear log", HoverText: "Removes all entries" },
                    () => {
                        this.logging.clear();
                        this.screen.reopen();
                    },
                ));
                MainCanvas.textAlign = "left";
            }
        }
    }
}
