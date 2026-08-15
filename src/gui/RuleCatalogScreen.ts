import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { RuleDefinition, RuleCategory } from "@/system/rules/RuleTypes";
import { RuleAccess } from "@/system/rules/RuleAccess";
import { ButtonActionWidget, DrawInfoPanel } from "@/system/gui/Widgets";
import { RuleConfigScreen } from "@/gui/RulesListScreen";
import { ElementSetVisible } from "@/utils/BCUtils";
import type { GUI } from "@/modules/GUI";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";
import type Rules from "@/modules/Rules";

const SEARCH_INPUT = "BCP_ruleSearch";
export const CATEGORY_ORDER: readonly RuleCategory[] = ["Speech", "Social", "Body", "Items", "Protection", "Sensory", "Rooms", "Other"];

const PER_PAGE = 14;
const ROWS_PER_COL = PER_PAGE / 2;
const ROW_H = 78;
const LIST_TOP = 245;
const NAME_W = 520;
const TAG_W = 170;
const COL_X = [125, 1010];

/**
 * The rule catalog: every not-yet-active rule, searchable and filterable by
 * category. Picking one activates it and opens its configuration.
 */
export class RuleCatalogScreen extends GUIScreen {

    constructor(
        module: Rules,
        character: BCPlusCharacter | null,
        readonly access: RuleAccess,
    ) {
        super(module, character);
    }

    get Title(): string {
        return this.Character && !this.Character.isPlayer()
            ? `Add rule - ${this.Character.Nickname}`
            : "Add rule";
    }

    protected buildPages(): GUIPage[] {
        return [new RuleCatalogPage(this)];
    }
}

class RuleCatalogPage extends GUIPage {

    private filterCategory: RuleCategory | null = null;
    private pageIndex = 0;
    private lastSearch = "";

    constructor(protected override readonly screen: RuleCatalogScreen) {
        super(screen);
    }

    get Config(): PageOptions {
        return {
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: "Every rule that is not active yet. Type in the search field to filter by "
                + "name or description, or narrow the list to one category with the buttons. "
                + "Picking a rule activates it immediately and opens its configuration page "
                + "(where it can also be deactivated again).",
        };
    }

    override async create(): Promise<void> {
        ElementCreateInput(SEARCH_INPUT, "text", "", "60");
    }

    override async destroy(): Promise<void> {
        ElementRemove(SEARCH_INPUT);
    }

    private search(): string {
        const input = document.getElementById(SEARCH_INPUT) as HTMLInputElement | null;
        return (input?.value ?? "").trim().toLocaleLowerCase();
    }

    private filtered(): RuleDefinition[] {
        const access = this.screen.access;
        const query = this.search();
        // Rules BCX covers (in effect or active there) are hidden too: they
        // already show in the rules list with a BCX chip, and that row's
        // config page can still activate them in BC+
        return access.definitions().filter((definition) => {
            if (access.state(definition.id).active
                || access.bcxStatus(definition.id) !== "none") {
                return false;
            }
            if (this.filterCategory !== null && definition.category !== this.filterCategory) {
                return false;
            }
            return query.length === 0
                || definition.name.toLocaleLowerCase().includes(query)
                || definition.description.toLocaleLowerCase().includes(query);
        });
    }

    render(): void {
        const access = this.screen.access;
        const canEdit = access.canEdit();

        // Right side of the header row - the screen title occupies the left
        ElementSetVisible(SEARCH_INPUT, !this.Screen.HelpVisible);
        MainCanvas.textAlign = "left";
        DrawText("Search:", 1090, 115, "Black");
        ElementPosition(SEARCH_INPUT, 1490, 110, 500, 56);

        const query = this.search();
        if (query !== this.lastSearch) {
            this.lastSearch = query;
            this.pageIndex = 0;
        }

        // Category filter row
        MainCanvas.textAlign = "center";
        const options: (RuleCategory | null)[] = [null, ...CATEGORY_ORDER];
        options.forEach((category, i) => {
            const x = 125 + i * 200;
            const selected = this.filterCategory === category;
            // The selected label is drawn manually in dark text: theme mods
            // repaint button labels white, unreadable on the light highlight
            DrawButton(x, 160, 190, 52, selected ? "" : (category ?? "All"), selected ? "#d0c3ea" : "White");
            if (selected) {
                DrawTextFit(category ?? "All", x + 95, 186, 180, "#2c2140");
            }
            this.addClickHandler(() => {
                if (MouseIn(x, 160, 190, 52)) {
                    this.filterCategory = category;
                    this.pageIndex = 0;
                }
            });
        });

        const matches = this.filtered();
        const pageCount = Math.max(1, Math.ceil(matches.length / PER_PAGE));
        this.pageIndex = Math.min(this.pageIndex, pageCount - 1);
        const pageItems = matches.slice(this.pageIndex * PER_PAGE, (this.pageIndex + 1) * PER_PAGE);
        let hovered: { definition: RuleDefinition; column: number } | null = null;

        pageItems.forEach((definition, i) => {
            const column = Math.floor(i / ROWS_PER_COL);
            const x = COL_X[column]!;
            const y = LIST_TOP + (i % ROWS_PER_COL) * ROW_H;
            this.addClickHandler(ButtonActionWidget(
                { Left: x, Top: y, Width: NAME_W, Height: 62 },
                { Name: definition.name, Active: canEdit },
                () => {
                    access.setActive(definition.id, true);
                    this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(
                        new RuleConfigScreen(this.screen.Module as Rules, this.Character, definition),
                    );
                },
            ));
            MainCanvas.textAlign = "left";
            DrawText(definition.category, x + NAME_W + 20, y + 40, "Gray");
            if (MouseIn(x, y, NAME_W + TAG_W, 62)) {
                hovered = { definition, column };
            }
        });

        MainCanvas.textAlign = "left";
        if (matches.length === 0) {
            DrawText("No rules match the search and filter.", 125, LIST_TOP + 40, "Gray");
        }
        DrawText(
            `${matches.length} rule${matches.length === 1 ? "" : "s"} available`
                + (canEdit ? "" : " - you do not have permission to add rules here"),
            125, 905, "Gray",
        );

        if (hovered !== null) {
            const { definition, column } = hovered as { definition: RuleDefinition; column: number };
            DrawInfoPanel(
                `${definition.name}  ·  ${definition.category}`,
                definition.description,
                { Left: COL_X[1 - column]!, Top: LIST_TOP, Width: NAME_W + TAG_W + 60, Height: ROWS_PER_COL * ROW_H - 16 },
            );
        }

        // Self-managed pager: the screen has a single framework page, so the
        // chrome never draws one
        if (pageCount > 1) {
            MainCanvas.textAlign = "center";
            DrawBackNextButton(
                1530, 860, 250, 90,
                `Page ${this.pageIndex + 1}/${pageCount}`,
                "White", "",
                () => "Previous page",
                () => "Next page",
            );
            this.addClickHandler(() => {
                if (MouseIn(1530, 860, 250, 90)) {
                    const delta = MouseX < 1530 + 125 ? -1 : 1;
                    this.pageIndex = (this.pageIndex + delta + pageCount) % pageCount;
                }
            });
        }
    }
}
