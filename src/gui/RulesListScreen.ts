import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { RuleDefinition } from "@/system/rules/RuleTypes";
import { LocalRuleAccess, RemoteRuleAccess, RuleAccess } from "@/system/rules/RuleAccess";
import { ButtonActionWidget, DrawInfoPanel } from "@/system/gui/Widgets";
import { ConditionsScreen } from "@/gui/ConditionsScreen";
import { RuleCatalogScreen, CATEGORY_ORDER } from "@/gui/RuleCatalogScreen";
import { describeConditions } from "@/system/conditions/Conditions";
import { ElementSetVisible } from "@/utils/BCUtils";
import type { GUI } from "@/modules/GUI";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";
import type Authority from "@/modules/Authority";
import type Rules from "@/modules/Rules";

const PER_PAGE = 16;
const LIST_COLS = 2;
const ROWS_PER_COL = PER_PAGE / LIST_COLS;
const ROW_H = 78;
const LIST_TOP = 195;
const NAME_W = 520;
const CHIP_W = 170;
const COL_X = [125, 1010];

/** One slot in the paginated list: a category header or an active rule. */
type ListItem = { header: string } | { definition: RuleDefinition };

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
        const items = this.buildItems();
        const pages: GUIPage[] = [];
        for (let i = 0; i < items.length; i += PER_PAGE) {
            pages.push(new RulesListPage(this, items.slice(i, i + PER_PAGE)));
        }
        if (pages.length === 0) {
            pages.push(new RulesListPage(this, []));
        }
        return pages;
    }

    /** Active rules in the owner's preferred presentation. */
    private buildItems(): ListItem[] {
        const active = this.access.definitions().filter((d) => this.access.state(d.id).active);
        if (this.access.sortMode() === "custom") {
            const position = new Map(this.access.order().map((id, i) => [id, i]));
            return active
                .sort((a, b) =>
                    (position.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.id) ?? Number.MAX_SAFE_INTEGER))
                .map((definition) => ({ definition }));
        }
        const items: ListItem[] = [];
        for (const category of CATEGORY_ORDER) {
            const group = active.filter((d) => d.category === category);
            if (group.length > 0) {
                items.push({ header: category });
                items.push(...group.map((definition) => ({ definition })));
            }
        }
        return items;
    }

    /** Ids of all active rules as currently displayed (for reordering). */
    displayedIds(): string[] {
        const ids: string[] = [];
        for (const page of this.Pages) {
            if (page instanceof RulesListPage) {
                ids.push(...page.ruleIds());
            }
        }
        return ids;
    }
}

class RulesListPage extends GUIPage {

    constructor(protected override readonly screen: RulesListScreen, private readonly items: ListItem[]) {
        super(screen);
    }

    get Config(): PageOptions {
        return {
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: "Your active rules. 'Add rule' opens the searchable catalog; 'Enable all' and "
                + "'Disable all' flip enforcement on every active rule at once (the rules stay "
                + "configured). The Sort button switches between grouping by category and your own "
                + "order - in Custom mode, use a row's arrows to move it. Click a rule to configure "
                + "or deactivate it.",
        };
    }

    /** Ids of the rules (not headers) on this page, in display order. */
    ruleIds(): string[] {
        return this.items.flatMap((item) => ("definition" in item ? [item.definition.id] : []));
    }

    private controlsRow(): void {
        const access = this.screen.access;
        const canEdit = access.canEdit();
        const local = this.Character === null || this.Character.isPlayer();
        const activeIds = this.screen.displayedIds();

        this.addClickHandler(ButtonActionWidget(
            { Left: 620, Top: 80, Width: 250, Height: 64 },
            { Name: "Add rule", Active: canEdit },
            () => {
                this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(
                    new RuleCatalogScreen(this.screen.Module as Rules, this.Character, access),
                );
            },
        ));
        this.addClickHandler(ButtonActionWidget(
            { Left: 890, Top: 80, Width: 250, Height: 64 },
            { Name: "Enable all", Active: canEdit && activeIds.length > 0, HoverText: "Enforce every active rule" },
            () => activeIds.forEach((id) => access.setEnforce(id, true)),
        ));
        this.addClickHandler(ButtonActionWidget(
            { Left: 1160, Top: 80, Width: 250, Height: 64 },
            { Name: "Disable all", Active: canEdit && activeIds.length > 0, HoverText: "Pause enforcement of every active rule (they stay configured)" },
            () => activeIds.forEach((id) => access.setEnforce(id, false)),
        ));
        // Sorting is the list owner's preference; there is no remote command
        // for it, so the toggle only shows on the own view
        if (local) {
            const mode = access.sortMode();
            this.addClickHandler(ButtonActionWidget(
                { Left: 1430, Top: 80, Width: 350, Height: 64 },
                { Name: `Sort: ${mode === "custom" ? "Custom" : "Category"}` },
                () => {
                    (this.screen.Module as Rules).setSortMode(mode === "custom" ? "category" : "custom");
                    this.Screen.reopen();
                },
            ));
        }
    }

    render(): void {
        const access = this.screen.access;
        // BCX deferral is a fact about THIS client's tandem state - it is
        // unknowable for a remote character's rules, so never shown there
        const local = this.Character === null || this.Character.isPlayer();
        const rules = this.screen.Module as Rules;
        const canEdit = access.canEdit();
        const reorderable = local && canEdit && access.sortMode() === "custom";
        const displayed = reorderable ? this.screen.displayedIds() : [];
        let hovered: { definition: RuleDefinition; column: number } | null = null;

        this.controlsRow();

        if (this.items.length === 0) {
            MainCanvas.textAlign = "left";
            DrawText("No rules are active. Use 'Add rule' to pick from the catalog.", 125, LIST_TOP + 40, "Gray");
        }

        this.items.forEach((item, i) => {
            const column = Math.floor(i / ROWS_PER_COL);
            const x = COL_X[column]!;
            const y = LIST_TOP + (i % ROWS_PER_COL) * ROW_H;

            if ("header" in item) {
                MainCanvas.textAlign = "left";
                DrawText(item.header, x + 8, y + 40, "Gray");
                return;
            }

            const definition = item.definition;
            const state = access.state(definition.id);
            this.addClickHandler(ButtonActionWidget(
                { Left: x, Top: y, Width: NAME_W, Height: 62 },
                { Name: definition.name },
                () => {
                    this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(
                        new RuleConfigScreen(this.screen.Module as Rules, this.Character, definition),
                    );
                },
            ));
            const deferred = local && state.active && rules.ruleDeferredToBCX(definition.id);
            const chip = deferred ? "BCX" : (state.enforce ? "Enforced" : "Paused");
            MainCanvas.textAlign = "left";
            DrawText(chip, x + NAME_W + 20, y + 40, deferred ? "#DAA520" : (state.enforce ? "Green" : "Gray"));
            if (state.conditions && Object.keys(state.conditions).length > 0) {
                DrawText("◈", x + NAME_W + CHIP_W - 24, y + 40, "Gray");
            }

            if (reorderable) {
                const position = displayed.indexOf(definition.id);
                const arrowX = x + NAME_W + CHIP_W + 10;
                MainCanvas.textAlign = "center";
                DrawButton(arrowX, y + 5, 52, 52, "▲", position > 0 ? "White" : "#ddd", "", "Move up", position <= 0);
                DrawButton(arrowX + 60, y + 5, 52, 52, "▼", position < displayed.length - 1 ? "White" : "#ddd", "", "Move down", position >= displayed.length - 1);
                this.addClickHandler(() => {
                    const delta = MouseIn(arrowX, y + 5, 52, 52) ? -1 : (MouseIn(arrowX + 60, y + 5, 52, 52) ? 1 : 0);
                    if (delta !== 0) {
                        (this.screen.Module as Rules).moveRuleInOrder(definition.id, delta as -1 | 1, displayed);
                        this.Screen.reopen();
                    }
                });
            }

            if (MouseIn(x, y, NAME_W + CHIP_W, 62)) {
                hovered = { definition, column };
            }
        });

        // Hovering a rule shows its details over the opposite column (BCX-style)
        if (hovered !== null) {
            const { definition, column } = hovered as { definition: RuleDefinition; column: number };
            const state = access.state(definition.id);
            const status = local && rules.ruleDeferredToBCX(definition.id)
                ? "Paused - BCX's matching rule is in effect, BC+ defers to it"
                : `Active${state.enforce ? ", enforced" : ""}${state.log ? ", logged" : ""}${state.announce ? ", announced" : ""}`;
            const origin = state.addedBy ? ` Set by ${state.addedBy.name} (#${state.addedBy.member}).` : "";
            DrawInfoPanel(
                `${definition.name}  ·  ${definition.category}`,
                `${definition.description} — ${status}. ${describeConditions(state.conditions)}.${origin}`,
                { Left: COL_X[1 - column]!, Top: LIST_TOP, Width: NAME_W + CHIP_W + 60, Height: ROWS_PER_COL * ROW_H - 16 },
            );
        }

        if (!canEdit) {
            MainCanvas.textAlign = "left";
            DrawText("You do not have permission to change these rules; viewing only.", 600, 920, "Gray");
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
        if ((this.Character === null || this.Character.isPlayer())
            && state.active
            && (this.screen.Module as Rules).ruleDeferredToBCX(definition.id)) {
            DrawText("Paused - BCX's matching rule is in effect, so BC+ defers to it.", 150, 200, "#DAA520");
        }

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
        if (state.active && state.addedBy) {
            DrawTextFit(`Set by ${state.addedBy.name} (#${state.addedBy.member})`, 1400, 470, 460, "Gray");
        }

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
                        // DOM inputs float above the canvas-drawn help box
                        ElementSetVisible(id, !this.screen.HelpVisible);
                        ElementPosition(id, 1250, y + 27, 750, 60);
                    }
                    break;
                }
            }
        });
    }
}
