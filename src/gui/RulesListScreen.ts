import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { RuleDefinition } from "@/system/rules/RuleTypes";
import { LocalRuleAccess, RemoteRuleAccess, RuleAccess } from "@/system/rules/RuleAccess";
import { ButtonActionWidget } from "@/system/gui/Widgets";
import { copyExportCode, promptImportCode } from "@/utils/ExportImport";
import { BCPNotifyPlayer } from "@/utils/Messaging";
import { ConditionsScreen } from "@/gui/ConditionsScreen";
import { describeConditions } from "@/system/conditions/Conditions";
import type { GUI } from "@/modules/GUI";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";
import type Authority from "@/modules/Authority";
import type Rules from "@/modules/Rules";

const PER_PAGE = 6;

function buildAccess(rules: Rules, character: BCPlusCharacter | null): RuleAccess {
    if (character && !character.isPlayer()) {
        const authority = rules.ModuleManager.getModule<Authority>("authority");
        return new RemoteRuleAccess(rules, authority, character);
    }
    return new LocalRuleAccess(rules);
}

export class RulesListScreen extends GUIScreen {

    readonly access: RuleAccess;

    constructor(module: Rules, character: BCPlusCharacter | null) {
        super(module, character);
        this.access = buildAccess(module, character);
    }

    get Title(): string {
        return this.Character && !this.Character.isPlayer()
            ? `Rules - ${this.Character.Nickname}`
            : "Rules";
    }

    protected buildPages(): GUIPage[] {
        const definitions = this.access.definitions();
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

    constructor(protected override readonly screen: RulesListScreen, private readonly definitions: RuleDefinition[]) {
        super(screen);
    }

    get Config(): PageOptions {
        return {
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: this.screen.Module.Config.HoverText,
        };
    }

    render(): void {
        const access = this.screen.access;
        if (!access.canEdit()) {
            DrawText("You do not have permission to change these rules; viewing only.", 150, 190, "Gray");
        }
        this.definitions.forEach((definition, i) => {
            const y = 220 + i * 110;
            const state = access.state(definition.id);
            const status = state.active
                ? `Active${state.enforce ? " / Enforced" : ""}${state.log ? " / Logged" : ""}`
                : "Inactive";
            this.addClickHandler(ButtonActionWidget(
                { Left: 150, Top: y, Width: 1100, Height: 90 },
                { Name: definition.name, HoverText: definition.description },
                () => {
                    this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(
                        new RuleConfigScreen(this.screen.Module as Rules, this.Character, definition),
                    );
                },
            ));
            DrawText(status, 1300, y + 45, state.active ? "Green" : "Gray");
            DrawText(definition.category, 1600, y + 45, "Gray");
        });

        // Export/import own rules as shareable codes (local screen only)
        if ((!this.Character || this.Character.isPlayer()) && access.canEdit()) {
            const rules = this.screen.Module as Rules;
            MainCanvas.textAlign = "center";
            this.addClickHandler(ButtonActionWidget(
                { Left: 150, Top: 890, Width: 200, Height: 60 },
                { Name: "Export", HoverText: "Copy your rules as a shareable code" },
                () => copyExportCode(rules.exportCode()),
            ));
            this.addClickHandler(ButtonActionWidget(
                { Left: 370, Top: 890, Width: 200, Height: 60 },
                { Name: "Import", HoverText: "Apply a rules code" },
                () => {
                    const code = promptImportCode();
                    if (code !== null) {
                        const applied = rules.importCode(code);
                        BCPNotifyPlayer(applied > 0 ? `Imported ${applied} rule${applied === 1 ? "" : "s"}.` : "That code could not be read.");
                        this.screen.reopen();
                    }
                },
            ));
            MainCanvas.textAlign = "left";
        }
    }
}

export class RuleConfigScreen extends GUIScreen {

    readonly access: RuleAccess;

    constructor(
        module: Rules,
        character: BCPlusCharacter | null,
        private readonly definition: RuleDefinition,
    ) {
        super(module, character);
        this.access = buildAccess(module, character);
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
}

class RuleConfigPage extends GUIPage {

    private readonly inputs = new Map<string, string>();

    constructor(protected override readonly screen: RuleConfigScreen) {
        super(screen);
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

    private inputId(name: string): string {
        return `BCP_rule_${name}`;
    }

    override async create(): Promise<void> {
        const definition = this.screen.Definition;
        const access = this.screen.access;
        for (const setting of definition.settings ?? []) {
            if (setting.type !== "text") {
                continue;
            }
            const id = this.inputId(setting.name);
            const current = String(access.state(definition.id).settings[setting.name] ?? setting.default);
            const element = ElementCreateInput(id, "text", current, String(setting.maxChars ?? 256));
            element.addEventListener("change", () => {
                access.setSetting(definition.id, setting.name, element.value);
            });
            this.inputs.set(setting.name, id);
        }
    }

    override async destroy(): Promise<void> {
        const definition = this.screen.Definition;
        const access = this.screen.access;
        for (const [name, id] of this.inputs) {
            const element = document.getElementById(id) as HTMLInputElement | null;
            if (element && element.value !== String(access.state(definition.id).settings[name] ?? "")) {
                access.setSetting(definition.id, name, element.value);
            }
            ElementRemove(id);
        }
        this.inputs.clear();
    }

    render(): void {
        const definition = this.screen.Definition;
        const access = this.screen.access;
        const state = access.state(definition.id);
        const canEdit = access.canEdit();

        MainCanvas.textAlign = "left";
        DrawTextWrap(definition.description, 150 - 1300 / 2, 170, 1300, 110, "Gray");

        const toggles: { label: string; value: boolean; set: (v: boolean) => void }[] = [
            {
                label: "Rule is active",
                value: state.active,
                set: (v) => access.setActive(definition.id, v),
            },
            {
                label: "Enforce (block the action)",
                value: state.enforce,
                set: (v) => access.setEnforce(definition.id, v),
            },
            {
                label: "Log violations",
                value: state.log,
                set: (v) => access.setLog(definition.id, v),
            },
            {
                label: "Announce breaches in chat",
                value: state.announce,
                set: (v) => access.setAnnounce(definition.id, v),
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

        // Conditions
        MainCanvas.textAlign = "center";
        this.addClickHandler(ButtonActionWidget(
            { Left: 1400, Top: 300, Width: 400, Height: 64 },
            { Name: "Conditions...", HoverText: "When this rule is in effect" },
            () => {
                this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(new ConditionsScreen(
                    this.screen.Module,
                    this.Character,
                    {
                        label: definition.name,
                        removeLabel: "Deactivate & clear",
                        get: () => access.state(definition.id).conditions ?? {},
                        set: (c) => access.setConditions(definition.id, c),
                        canEdit: () => access.canEdit(),
                    },
                ));
            },
        ));
        MainCanvas.textAlign = "left";
        DrawTextFit(describeConditions(state.conditions), 1400, 420, 460, "Gray");

        const settings = definition.settings ?? [];
        settings.forEach((setting, i) => {
            const y = 660 + i * 80;
            const active = canEdit && (setting.active?.() ?? true);
            switch (setting.type) {
                case "checkbox": {
                    const checked = state.settings[setting.name] as boolean;
                    DrawCheckbox(150, y, 64, 64, setting.label, checked, !active);
                    this.addClickHandler(() => {
                        if (active && MouseIn(150, y, 64, 64)) {
                            access.setSetting(definition.id, setting.name, !checked);
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
                        access.setSetting(definition.id, setting.name, next);
                    });
                    break;
                }
                case "text": {
                    DrawText(setting.label, 150, y + 32, "Black");
                    const id = this.inputs.get(setting.name);
                    if (id) {
                        const element = document.getElementById(id) as HTMLInputElement | null;
                        if (element) {
                            element.disabled = !active;
                        }
                        ElementPosition(id, 1250, y + 27, 750, 60);
                    }
                    break;
                }
            }
        });
    }
}
