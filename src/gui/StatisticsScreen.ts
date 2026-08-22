import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import {
    COUNTER_LABELS, STATE_LABELS, StatsSnapshot, formatStatDuration,
} from "@/system/statistics/StatTypes";
import { ButtonActionWidget } from "@/system/gui/Widgets";
import { modalConfirm } from "@/gui/Modal";
import type Authority from "@/modules/Authority";
import type Rules from "@/modules/Rules";
import type Statistics from "@/modules/Statistics";

const ROWS_PER_PAGE = 10;

export class StatisticsScreen extends GUIScreen {

    get Title(): string {
        return this.Character && !this.Character.isPlayer()
            ? `Statistics - ${this.Character.Nickname}`
            : "Statistics";
    }

    get Statistics(): Statistics {
        return this.Module as Statistics;
    }

    get Remote(): boolean {
        return this.Character !== null && !this.Character.isPlayer();
    }

    protected buildPages(): GUIPage[] {
        if (this.Remote) {
            const fetched = this.Statistics.getRemoteStats(this.Character!.MemberNumber);
            if (typeof fetched !== "object" || fetched === null) {
                return [new StatsStatusPage(this, null)];
            }
            return this.makePages(fetched);
        }
        if (!this.Statistics.canView()) {
            return [new StatsStatusPage(this, "You are not permitted to view your own statistics.")];
        }
        return this.makePages(this.Statistics.snapshot());
    }

    private makePages(stats: StatsSnapshot): GUIPage[] {
        const pages: GUIPage[] = [new StatsOverviewPage(this, stats)];

        const items = Object.entries(stats.items).sort((a, b) => b[1] - a[1]);
        for (let i = 0; i < items.length; i += ROWS_PER_PAGE) {
            pages.push(new StatsTablePage(this, "Time in items", items.slice(i, i + ROWS_PER_PAGE)
                .map(([name, ms]) => ({ label: name, value: this.withShare(ms, stats.play) }))));
        }

        const rules = this.Core.ModuleManager.getModule<Rules>("rules");
        const violations = Object.entries(stats.rules).sort((a, b) => b[1] - a[1]);
        for (let i = 0; i < violations.length; i += ROWS_PER_PAGE) {
            pages.push(new StatsTablePage(this, "Rule violations", violations.slice(i, i + ROWS_PER_PAGE)
                .map(([id, count]) => ({
                    label: rules?.getDefinition(id)?.name ?? id,
                    value: `${count}`,
                }))));
        }
        return pages;
    }

    /** "2h 15m (34%)" - duration plus its share of the total play time. */
    withShare(ms: number, play: number): string {
        const share = play > 0 ? Math.min(100, Math.round((ms / play) * 100)) : 0;
        return `${formatStatDuration(ms)} (${share}%)`;
    }
}

abstract class StatsPage extends GUIPage {

    private removeListener: (() => void) | null = null;

    protected get statsScreen(): StatisticsScreen {
        return this.screen as StatisticsScreen;
    }

    get Config(): PageOptions {
        return {
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: this.statsScreen.Statistics.Config.HoverText,
        };
    }

    /** Remote pages rebuild when fresh statistics (or a denial) arrive. */
    override async create(): Promise<void> {
        const character = this.Character;
        if (character && !character.isPlayer()) {
            this.removeListener = this.Core.Events.on("statsReceived", ({ memberNumber }) => {
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
}

/** Own no-permission notice, or the pending/denied/timeout state of a remote request. */
class StatsStatusPage extends StatsPage {

    constructor(screen: StatisticsScreen, private readonly notice: string | null) {
        super(screen);
    }

    override async create(): Promise<void> {
        await super.create();
        const character = this.Character;
        if (character && !character.isPlayer()
            && this.statsScreen.Statistics.getRemoteStats(character.MemberNumber) === undefined) {
            this.statsScreen.Statistics.requestStats(character.MemberNumber);
        }
    }

    render(): void {
        if (this.notice !== null) {
            DrawText(this.notice, 150, 250, "Gray");
            return;
        }
        const character = this.Character!;
        const fetched = this.statsScreen.Statistics.getRemoteStats(character.MemberNumber);
        if (fetched === "denied") {
            DrawText(`${character.Nickname} does not permit you to view their statistics.`, 150, 250, "Gray");
        } else if (fetched === "timeout") {
            DrawText("No response - they may be busy, disconnected, or running an older BC+.", 150, 250, "Gray");
        } else {
            DrawText("Requesting statistics...", 150, 250, "Gray");
        }
    }
}

class StatsOverviewPage extends StatsPage {

    constructor(screen: StatisticsScreen, private readonly stats: StatsSnapshot) {
        super(screen);
    }

    render(): void {
        const stats = this.stats;
        const since = stats.since > 0 ? new Date(stats.since).toLocaleDateString() : "-";
        DrawText(`Recording since ${since}`, 150, 190, "Black", "Gray");
        DrawText(`Total play time: ${formatStatDuration(stats.play)}`, 1050, 190, "Black", "Gray");

        DrawText("Time spent", 150, 250, "Gray");
        STATE_LABELS.forEach((state, i) => {
            const y = 300 + i * 40;
            DrawText(state.label, 150, y, "Black");
            DrawText(this.statsScreen.withShare(stats.states[state.id] ?? 0, stats.play), 560, y, "Gray");
        });

        DrawText("Events", 1050, 250, "Gray");
        COUNTER_LABELS.forEach((counter, i) => {
            const y = 300 + i * 40;
            DrawText(counter.label, 1050, y, "Black");
            DrawText(`${stats.counters[counter.id] ?? 0}`, 1560, y, "Gray");
        });

        this.renderButtons();
    }

    private renderButtons(): void {
        const statistics = this.statsScreen.Statistics;
        const character = this.Character;
        MainCanvas.textAlign = "center";
        if (!character || character.isPlayer()) {
            if (statistics.canReset()) {
                this.addClickHandler(ButtonActionWidget(
                    { Left: 150, Top: 880, Width: 300, Height: 70 },
                    { Name: "Reset stats", HoverText: "Wipes all counters and starts over" },
                    () => {
                        void modalConfirm("Reset all statistics? This cannot be undone.", true).then((confirmed) => {
                            if (confirmed) {
                                statistics.resetStats();
                                this.screen.reopen();
                            }
                        });
                    },
                ));
            }
        } else {
            const authority = this.Core.ModuleManager.getModule<Authority>("authority");
            const canReset = authority?.remoteHasPermission(character, "stats.reset") ?? false;
            this.addClickHandler(ButtonActionWidget(
                { Left: 150, Top: 880, Width: 300, Height: 70 },
                { Name: "Reset stats", Active: canReset, HoverText: "Wipes their counters (their client validates)" },
                () => {
                    void modalConfirm(`Reset ${character.Nickname}'s statistics? This cannot be undone.`, true).then((confirmed) => {
                        if (confirmed) {
                            statistics.requestReset(character.MemberNumber);
                        }
                    });
                },
            ));
            this.addClickHandler(ButtonActionWidget(
                { Left: 490, Top: 880, Width: 300, Height: 70 },
                { Name: "Refresh", HoverText: "Request their latest numbers" },
                () => {
                    statistics.requestStats(character.MemberNumber);
                    this.screen.reopen();
                },
            ));
        }
        MainCanvas.textAlign = "left";
    }
}

class StatsTablePage extends StatsPage {

    constructor(
        screen: StatisticsScreen,
        private readonly subtitle: string,
        private readonly rows: { label: string; value: string }[],
    ) {
        super(screen);
    }

    override get Config(): PageOptions {
        return { ...super.Config, title: `${this.statsScreen.Title} - ${this.subtitle}` };
    }

    render(): void {
        this.rows.forEach((row, i) => {
            const y = 244 + i * 64;
            DrawTextFit(row.label, 150, y, 900, "Black");
            DrawText(row.value, 1120, y, "Gray");
        });
    }
}
