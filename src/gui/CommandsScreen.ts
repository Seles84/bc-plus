import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { ButtonActionWidget } from "@/system/gui/Widgets";
import { CommandDefinition } from "@/system/commands/CommandTypes";
import type Authority from "@/modules/Authority";
import type Commands from "@/modules/Commands";

const ARGUMENT_INPUT = "BCP_commandArg";
const PER_PAGE = 7;

export class CommandsScreen extends GUIScreen {

    get Title(): string {
        return this.Character && !this.Character.isPlayer()
            ? `Commands - ${this.Character.Nickname}`
            : "Commands";
    }

    private get commands(): Commands {
        return this.Module as Commands;
    }

    /** Best-effort preview; the target enforces for real. */
    canUse(): boolean {
        if (!this.Character || this.Character.isPlayer()) {
            return this.commands.canUseOnSelf();
        }
        const authority = this.Module.ModuleManager.getModule<Authority>("authority");
        return authority?.remoteHasPermission(this.Character, "commands.use") ?? false;
    }

    protected buildPages(): GUIPage[] {
        const definitions = [...this.commands.Definitions];
        const pages: GUIPage[] = [];
        for (let i = 0; i < Math.max(1, Math.ceil(definitions.length / PER_PAGE)); i++) {
            pages.push(new CommandsPage(this, definitions.slice(i * PER_PAGE, (i + 1) * PER_PAGE)));
        }
        return pages;
    }
}

class CommandsPage extends GUIPage {

    constructor(protected override readonly screen: CommandsScreen, private readonly definitions: CommandDefinition[]) {
        super(screen);
    }

    private get commands(): Commands {
        return this.screen.Module as Commands;
    }

    get Config(): PageOptions {
        return {
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: this.commands.Config.HoverText
                + " Commands that take an argument use the text field at the bottom of the screen.",
        };
    }

    override async create(): Promise<void> {
        ElementCreateInput(ARGUMENT_INPUT, "text", "", "200");
    }

    override async destroy(): Promise<void> {
        ElementRemove(ARGUMENT_INPUT);
    }

    render(): void {
        const canUse = this.screen.canUse();
        if (!canUse) {
            DrawText("You do not have permission to use commands here.", 150, 190, "Gray");
        }

        this.definitions.forEach((definition, i) => {
            const y = 220 + i * 90;
            MainCanvas.textAlign = "center";
            this.addClickHandler(ButtonActionWidget(
                { Left: 150, Top: y, Width: 400, Height: 70 },
                { Name: definition.name, Active: canUse, HoverText: definition.description },
                () => {
                    const input = document.getElementById(ARGUMENT_INPUT) as HTMLInputElement | null;
                    this.commands.invoke(definition, input?.value ?? "", this.Character);
                },
            ));
            MainCanvas.textAlign = "left";
            DrawTextFit(
                definition.description + (definition.argument ? " (uses the argument field)" : ""),
                600, y + 40, 1250, "Gray",
            );
        });

        DrawText("Argument:", 150, 910, "Black");
        ElementPosition(ARGUMENT_INPUT, 800, 905, 900, 60);
        const input = document.getElementById(ARGUMENT_INPUT) as HTMLInputElement | null;
        if (input) {
            input.disabled = !canUse;
        }
    }
}
