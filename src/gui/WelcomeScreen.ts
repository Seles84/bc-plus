import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { ButtonActionWidget } from "@/system/gui/Widgets";
import { BCPLUS_APP_NAME, BCPLUS_VERSION } from "@/system/Constants";
import { MainMenu } from "@/gui/MainMenu";
import type { BCPPreset } from "@/modules/Core";
import type Core from "@/modules/Core";
import type { GUI } from "@/modules/GUI";

/** First-run welcome: a short introduction, then the preset choice. */
export class WelcomeScreen extends GUIScreen {

    get Title(): string {
        return "Welcome";
    }

    protected buildPages(): GUIPage[] {
        return [new WelcomePage(this), new PresetPage(this)];
    }

    /** @internal Finishes the welcome and enters the normal menu. */
    finish(): void {
        (this.Core.ModuleManager.getModule("core") as Core | undefined)?.completeFirstRun();
        this.Core.ModuleManager.getModule<GUI>("gui")?.setSubscreen(new MainMenu(this.Module, this.Character));
    }
}

class WelcomePage extends GUIPage {

    constructor(protected override readonly screen: WelcomeScreen) {
        super(screen);
    }

    get Config(): PageOptions {
        return {
            title: `Welcome to ${BCPLUS_APP_NAME}`,
            showTitle: true,
            showBack: false,
            showHelp: false,
        };
    }

    render(): void {
        const lines = [
            `BC+ v${BCPLUS_VERSION} is now part of your club life. A quick tour:`,
            "",
            "· Rules - restrictions on speech, items, movement and more, with conditions and timers.",
            "· Curses - lock item slots so only permitted items can be worn.",
            "· Roles & Authority - decide exactly who may do what to you, from your BC Owner",
            "  down to custom roles you invent with hand-picked permissions.",
            "· Commands - one-shot orders like kneeling or forced speech.",
            "· Log - a private record of everything that happens under BC+.",
            "",
            "Everything others can do to you is controlled by your permissions, and your own",
            "client always has the final word. Type /bcp help in chat for quick commands.",
            this.Core.Mode === "tandem"
                ? "BCX detected: BC+ runs alongside it and stays out of its way."
                : "",
        ];
        lines.forEach((line, i) => {
            DrawText(line, 150, 230 + i * 48, line.startsWith("·") ? "Black" : "Gray");
        });

        MainCanvas.textAlign = "center";
        this.addClickHandler(ButtonActionWidget(
            { Left: 150, Top: 880, Width: 400, Height: 80 },
            { Name: "Choose a preset..." },
            () => this.screen.nextPage(),
        ));
        MainCanvas.textAlign = "left";
    }
}

const PRESET_CHOICES: { preset: BCPPreset; blurb: string }[] = [
    {
        preset: "Dominant",
        blurb: "You hold the keys. Rules, curses and the log never apply to you, and your permissions "
            + "start fully closed - nobody gets access unless you open it. BC+ is your toolkit for managing others.",
    },
    {
        preset: "Switch",
        blurb: "The balanced middle: everything available, permissions at sensible defaults "
            + "(your Owner and Mistresses can manage you; you keep full self-access).",
    },
    {
        preset: "Submissive",
        blurb: "Ready for the receiving end: anyone may view your BC+, your Owner and Mistresses can "
            + "manage you - and you keep control of your own settings.",
    },
    {
        preset: "Slave",
        blurb: "Hands off the wheel: after a confirmation, you lose self-access to your rules, curses, "
            + "permissions, roles and log clearing. Only those you empower can change them - and only "
            + "they can give control back.",
    },
];

class PresetPage extends GUIPage {

    constructor(protected override readonly screen: WelcomeScreen) {
        super(screen);
    }

    get Config(): PageOptions {
        return {
            title: "How do you play?",
            showTitle: true,
            showBack: false,
            showHelp: false,
        };
    }

    render(): void {
        const core = this.Core.ModuleManager.getModule("core") as Core | undefined;
        DrawText("Pick the preset that fits you - it configures your permissions to match and then locks in. Only a factory reset clears it.", 150, 220, "Gray");

        MainCanvas.textAlign = "center";
        PRESET_CHOICES.forEach((choice, i) => {
            const y = 280 + i * 130;
            this.addClickHandler(ButtonActionWidget(
                { Left: 150, Top: y, Width: 360, Height: 90 },
                { Name: choice.preset },
                () => {
                    // The choice confirms via modal; declining keeps you on this page
                    void core?.choosePreset(choice.preset).then((applied) => {
                        if (applied) {
                            this.screen.finish();
                        }
                    });
                },
            ));
            MainCanvas.textAlign = "left";
            DrawTextWrap(choice.blurb, 560 - 1250 / 2, y, 1250, 90, "Gray");
            MainCanvas.textAlign = "center";
        });

        this.addClickHandler(ButtonActionWidget(
            { Left: 150, Top: 880, Width: 400, Height: 70 },
            { Name: "Decide later (Switch)" },
            () => this.screen.finish(),
        ));
        MainCanvas.textAlign = "left";
    }
}
