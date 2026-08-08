import { err } from "@/system/Console";
import type { ModuleInstance } from "@/system/module/ModuleInstance";
import type { BCPlus } from "@/index";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";
import type { GUI } from "@/modules/GUI";

export const EXIT_BUTTON = [1815, 75, 90, 90] as const;
export const HELP_BUTTON = [1815, 190, 90, 90] as const;
const PAGE_SELECT = [1530, 860, 250, 90] as const;

export interface PageOptions {
    /** Shown in the header after "Bondage Club Plus - "; falls back to the screen title */
    title?: string;
    showTitle: boolean;
    showBack: boolean;
    /** Shows the help button; requires `helpText` */
    showHelp: boolean;
    helpText?: string;
}

export abstract class GUIPage {

    private clickHandlers: (() => void)[] = [];

    constructor(protected readonly screen: GUIScreen) {}

    abstract get Config(): PageOptions;

    /** Called when the page becomes active - load data, create DOM elements, etc. */
    async create(): Promise<void> {}

    /** Called every frame while active. Register click regions via addClickHandler. */
    abstract render(): void;

    /** Called when the page is left - remove DOM elements, drop data. */
    async destroy(): Promise<void> {}

    /**
     * Registers a click region for this frame. Handlers reset every frame,
     * so pages simply re-register during render (immediate-mode style).
     */
    protected addClickHandler(handler: () => void): void {
        this.clickHandlers.push(handler);
    }

    /** @internal Called by the screen at the start of every frame. */
    beginFrame(): void {
        this.clickHandlers = [];
    }

    /** @internal Dispatches the current click to all registered regions. */
    dispatchClick(): void {
        for (const handler of this.clickHandlers) {
            try {
                handler();
            } catch (e) {
                err("Click handler failed:", e);
            }
        }
    }

    get Screen(): GUIScreen {
        return this.screen;
    }

    get Core(): BCPlus {
        return this.screen.Core;
    }

    get Character(): BCPlusCharacter | null {
        return this.screen.Character;
    }
}

export abstract class GUIScreen {

    private pages: GUIPage[] | null = null;
    private pageIndex = 0;
    private pageReady = false;
    private helpVisible = false;

    constructor(
        private readonly module: ModuleInstance,
        private readonly character: BCPlusCharacter | null = null,
    ) {}

    abstract get Title(): string;

    /** Build the page list once; cached for the lifetime of the screen. */
    protected abstract buildPages(): GUIPage[];

    get Pages(): GUIPage[] {
        this.pages ??= this.buildPages();
        return this.pages;
    }

    get ActivePage(): GUIPage | null {
        return this.Pages[this.pageIndex] ?? null;
    }

    get Module(): ModuleInstance {
        return this.module;
    }

    get Core(): BCPlus {
        return this.module.Core;
    }

    get Character(): BCPlusCharacter | null {
        return this.character;
    }

    /** @internal Called by the GUI module when the screen becomes active. */
    open(): void {
        void this.setPage(0);
    }

    /** @internal Called by the GUI module when navigating back to this screen. */
    reopen(): void {
        void this.setPage(this.pageIndex);
    }

    /** Called every frame while this screen is active. */
    render(): void {
        const page = this.ActivePage;
        if (!page || !this.pageReady) {
            return;
        }
        const prevAlign = MainCanvas.textAlign;
        try {
            this.renderChrome(page);
            MainCanvas.textAlign = "left";
            page.beginFrame();
            page.render();
            if (this.helpVisible && page.Config.helpText) {
                this.renderHelp(page.Config.helpText);
            }
        } catch (e) {
            err("Failed to render screen:", e);
        } finally {
            MainCanvas.textAlign = prevAlign;
        }
    }

    /** Called on every canvas click while this screen is active. */
    click(): void {
        const page = this.ActivePage;
        if (!page || !this.pageReady) {
            return;
        }
        if (this.helpVisible) {
            this.helpVisible = false;
            return;
        }
        const config = page.Config;
        if (config.showBack && MouseIn(...EXIT_BUTTON)) {
            this.exit();
            return;
        }
        if (config.showHelp && config.helpText && MouseIn(...HELP_BUTTON)) {
            this.helpVisible = true;
            return;
        }
        if (this.Pages.length > 1 && MouseIn(...PAGE_SELECT)) {
            const [left, , width] = PAGE_SELECT;
            if (MouseX < left + width / 2) {
                this.prevPage();
            } else {
                this.nextPage();
            }
            return;
        }
        page.dispatchClick();
    }

    /** Steps back to the previous BC+ screen, or out of BC+ from the root screen. */
    exit(): void {
        this.module.ModuleManager.getModule<GUI>("gui")?.backSubscreen();
    }

    nextPage(): void {
        void this.setPage((this.pageIndex + 1) % this.Pages.length);
    }

    prevPage(): void {
        void this.setPage((this.pageIndex - 1 + this.Pages.length) % this.Pages.length);
    }

    /** @internal Called by the GUI module when the screen is replaced. */
    async destroy(): Promise<void> {
        this.pageReady = false;
        await this.ActivePage?.destroy();
    }

    private async setPage(index: number): Promise<void> {
        this.helpVisible = false;
        if (this.pageReady) {
            this.pageReady = false;
            await this.ActivePage?.destroy();
        }
        this.pageIndex = index;
        try {
            await this.ActivePage?.create();
        } catch (e) {
            err("Failed to create page:", e);
        }
        this.pageReady = true;
    }

    private renderChrome(page: GUIPage): void {
        const config = page.Config;
        if (config.showTitle) {
            MainCanvas.textAlign = "left";
            DrawText(`Bondage Club Plus - ${config.title || this.Title}`, 100, 125, "Black", "Gray");
        }
        MainCanvas.textAlign = "center";
        if (config.showBack) {
            DrawButton(...EXIT_BUTTON, "", "White", "Icons/Exit.png", "Back");
        }
        if (config.showHelp && config.helpText) {
            DrawButton(...HELP_BUTTON, "", "White", "Icons/Question.png", "Help");
        }
        if (this.Pages.length > 1) {
            DrawBackNextButton(
                ...PAGE_SELECT,
                `Page ${this.pageIndex + 1}/${this.Pages.length}`,
                "White", "",
                () => "Previous page",
                () => "Next page",
            );
        }
    }

    private renderHelp(helpText: string): void {
        MainCanvas.save();
        DrawRect(1000, 190, 800, 600, "#ffff88");
        DrawEmptyRect(1000, 190, 800, 600, "Black");
        MainCanvas.textAlign = "left";
        DrawTextWrap(helpText, 1020 - 760 / 2, 210, 760, 560, "Black");
        MainCanvas.restore();
    }
}
