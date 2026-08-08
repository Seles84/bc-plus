import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { RuleDefinition } from "@/system/rules/RuleTypes";
import { ButtonActionWidget } from "@/system/gui/Widgets";
import type { GUI } from "@/modules/GUI";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";
import type Rules from "@/modules/Rules";

const PER_PAGE = 6;

export class RulesListScreen extends GUIScreen {

    get Title(): string {
        return "Rules";
    }

    private get rules(): Rules {
        return this.Module as Rules;
    }

    protected buildPages(): GUIPage[] {
        const definitions = this.rules.Definitions;
        const pages: GUIPage[] = [];
        for (let i = 0; i < definitions.length; i += PER_PAGE) {
            pages.push(new RulesListPage(this, definitions.slice(i, i + PER_PAGE)));
        }
        if (pages.length === 0) {
            pages.push(new RulesListPage(this, []));
        }
        return pages;
    }
}

class RulesListPage extends GUIPage {

    constructor(screen: RulesListScreen, private readonly definitions: RuleDefinition[]) {
        super(screen);
    }

    private get rules(): Rules {
        return this.Screen.Module as Rules;
    }

    get Config(): PageOptions {
        return {
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: this.rules.Config.HoverText,
        };
    }

    render(): void {
        if (!this.rules.canEdit()) {
            DrawText("You do not have permission to change rules; viewing only.", 150, 190, "Gray");
        }
        this.definitions.forEach((definition, i) => {
            const y = 220 + i * 110;
            const state = this.rules.ruleState(definition.id);
            const status = state.active
                ? `Active${state.enforce ? " / Enforced" : ""}${state.log ? " / Logged" : ""}`
                : "Inactive";
            this.addClickHandler(ButtonActionWidget(
                { Left: 150, Top: y, Width: 1100, Height: 90 },
                { Name: definition.name, HoverText: definition.description },
                () => {
                    this.Core.ModuleManager.getModule<GUI>("gui")?.setSubscreen(
                        new RuleConfigScreen(this.rules, this.Character, definition),
                    );
                },
            ));
            DrawText(status, 1300, y + 45, state.active ? "Green" : "Gray");
            DrawText(definition.category, 1600, y + 45, "Gray");
        });
    }
}

export class RuleConfigScreen extends GUIScreen {

    constructor(
        module: Rules,
        character: BCPlusCharacter | null,
        private readonly definition: RuleDefinition,
    ) {
        super(module, character);
    }

    get Title(): string {
        return `Rule - ${this.definition.name}`;
    }

    get Definition(): RuleDefinition {
        return this.definition;
    }

    protected buildPages(): GUIPage[] {
        return [new RuleConfigPage(this)];
    }

    /** Back returns to the rules list instead of closing BC+ screens. */
    override exit(): void {
        void this.ActivePage?.destroy();
        this.Core.ModuleManager.getModule<GUI>("gui")?.setSubscreen(
            new RulesListScreen(this.Module, this.Character),
        );
    }
}

class RuleConfigPage extends GUIPage {

    constructor(protected override readonly screen: RuleConfigScreen) {
        super(screen);
    }

    private get rules(): Rules {
        return this.screen.Module as Rules;
    }

    get Config(): PageOptions {
        return {
            title: this.screen.Title,
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: this.screen.Definition.description,
        };
    }

    render(): void {
        const definition = this.screen.Definition;
        const state = this.rules.ruleState(definition.id);
        const canEdit = this.rules.canEdit();

        MainCanvas.textAlign = "left";
        DrawTextWrap(definition.description, 150 - 1300 / 2, 170, 1300, 110, "Gray");

        const toggles: { label: string; value: boolean; set: (v: boolean) => void }[] = [
            {
                label: "Rule is active",
                value: state.active,
                set: (v) => this.rules.setRuleActive(definition.id, v),
            },
            {
                label: "Enforce (block the action)",
                value: state.enforce,
                set: (v) => { state.enforce = v; },
            },
            {
                label: "Log violations",
                value: state.log,
                set: (v) => { state.log = v; },
            },
        ];

        toggles.forEach((toggle, i) => {
            const y = 300 + i * 80;
            DrawCheckbox(150, y, 64, 64, toggle.label, toggle.value, !canEdit);
            this.addClickHandler(() => {
                if (canEdit && MouseIn(150, y, 64, 64)) {
                    toggle.set(!toggle.value);
                }
            });
        });

        const settings = definition.settings ?? [];
        settings.forEach((setting, i) => {
            const y = 580 + i * 80;
            const active = canEdit && (setting.active?.() ?? true);
            switch (setting.type) {
                case "checkbox": {
                    const checked = state.settings[setting.name] as boolean;
                    DrawCheckbox(150, y, 64, 64, setting.label, checked, !active);
                    this.addClickHandler(() => {
                        if (active && MouseIn(150, y, 64, 64)) {
                            state.settings[setting.name] = !checked;
                            setting.onSet?.(!checked, checked);
                        }
                    });
                    break;
                }
                case "option": {
                    const value = state.settings[setting.name] as string;
                    DrawText(setting.label, 150, y + 32, "Black");
                    MainCanvas.textAlign = "center";
                    DrawBackNextButton(850, y, 350, 64, value, active ? "White" : "#ddd", "", () => "", () => "", !active);
                    MainCanvas.textAlign = "left";
                    this.addClickHandler(() => {
                        if (!active || !MouseIn(850, y, 350, 64)) {
                            return;
                        }
                        const index = setting.options.indexOf(value);
                        const direction = MouseX < 850 + 175 ? -1 : 1;
                        const next = setting.options[(index + direction + setting.options.length) % setting.options.length]!;
                        state.settings[setting.name] = next;
                        setting.onSet?.(next, value);
                    });
                    break;
                }
            }
        });
    }
}
