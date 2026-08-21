import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { ElementSetVisible } from "@/utils/BCUtils";
import type { ModuleInstance } from "@/system/module/ModuleInstance";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";

const SEARCH_INPUT = "BCP_assetSearch";

const COLS = 9;
const ROWS = 3;
const PER_PAGE = COLS * ROWS;
const CELL_W = 160;
const CELL_H = 205;
const PITCH_X = 175;
const PITCH_Y = 220;
const GRID_LEFT = 125;
const GRID_TOP = 235;

/** Adapter a caller provides: which slot to browse and what a pick does. */
export interface AssetPickTarget {
    /** Screen title, e.g. "Add item - Arms" */
    title: string;
    group: AssetGroupName;
    helpText: string;
    /** Called with the picked asset; the picker closes itself afterwards. */
    pick(asset: Asset): void;
}

/**
 * Assets offered for a group: wearable, enabled, and either free or owned by
 * the local player (the configuring side often supplies bought items, matching
 * BC's own dialog, where the acting character's inventory counts too).
 */
export function catalogAssets(group: AssetGroupName): Asset[] {
    const groupDef = AssetGroupGet(Player.AssetFamily, group);
    return (groupDef?.Asset ?? [])
        .filter((a) => a.Wear && a.Enable && !a.IsLock
            && (a.Value >= 0 || InventoryAvailable(Player, a.Name, group)))
        .sort((a, b) => a.Description.localeCompare(b.Description));
}

/**
 * A visual browser over every asset wearable in one slot, searchable, used to
 * pick items for curses and punishments without having to wear them first.
 */
export class AssetPickerScreen extends GUIScreen {

    constructor(
        module: ModuleInstance,
        character: BCPlusCharacter | null,
        readonly target: AssetPickTarget,
    ) {
        super(module, character);
    }

    get Title(): string {
        return this.target.title;
    }

    protected buildPages(): GUIPage[] {
        return [new AssetPickerPage(this)];
    }
}

class AssetPickerPage extends GUIPage {

    private assets: Asset[] = [];
    private pageIndex = 0;
    private lastSearch = "";

    constructor(protected override readonly screen: AssetPickerScreen) {
        super(screen);
    }

    get Config(): PageOptions {
        return {
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: this.screen.target.helpText,
        };
    }

    override async create(): Promise<void> {
        this.assets = catalogAssets(this.screen.target.group);
        ElementCreateInput(SEARCH_INPUT, "text", "", "60");
    }

    override async destroy(): Promise<void> {
        ElementRemove(SEARCH_INPUT);
    }

    private search(): string {
        const input = document.getElementById(SEARCH_INPUT) as HTMLInputElement | null;
        return (input?.value ?? "").trim().toLocaleLowerCase();
    }

    private filtered(): Asset[] {
        const query = this.search();
        if (query.length === 0) {
            return this.assets;
        }
        return this.assets.filter((a) =>
            a.Description.toLocaleLowerCase().includes(query)
            || a.Name.toLocaleLowerCase().includes(query));
    }

    render(): void {
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

        const matches = this.filtered();
        const pageCount = Math.max(1, Math.ceil(matches.length / PER_PAGE));
        this.pageIndex = Math.min(this.pageIndex, pageCount - 1);
        const pageItems = matches.slice(this.pageIndex * PER_PAGE, (this.pageIndex + 1) * PER_PAGE);

        // BC's preview boxes draw their labels centered-relative - in the
        // framework's left-aligned mode they start mid-cell and spill over
        // their neighbors, so the grid runs in centered mode
        MainCanvas.textAlign = "center";
        let hovered: Asset | null = null;
        pageItems.forEach((asset, i) => {
            const x = GRID_LEFT + (i % COLS) * PITCH_X;
            const y = GRID_TOP + Math.floor(i / COLS) * PITCH_Y;
            DrawAssetPreview(x, y, asset, { Width: CELL_W, Height: CELL_H, Border: true, Hover: true });
            if (MouseIn(x, y, CELL_W, CELL_H)) {
                hovered = asset;
            }
            this.addClickHandler(() => {
                if (MouseIn(x, y, CELL_W, CELL_H)) {
                    this.screen.target.pick(asset);
                    this.Screen.exit();
                }
            });
        });
        MainCanvas.textAlign = "left";

        if (matches.length === 0) {
            DrawText("No items match the search.", GRID_LEFT, GRID_TOP + 40, "Gray");
        }
        DrawText(`${matches.length} item${matches.length === 1 ? "" : "s"}`, GRID_LEFT, 925, "Gray");
        if (hovered !== null) {
            // Long names shrink tiny inside the cells - spell the hovered one out
            MainCanvas.textAlign = "center";
            DrawTextFit((hovered as Asset).Description, 900, 925, 700, "Gray");
            MainCanvas.textAlign = "left";
        }

        // Self-managed pager: the screen has a single framework page, so the
        // chrome never draws one
        if (pageCount > 1) {
            MainCanvas.textAlign = "center";
            DrawBackNextButton(
                1530, 890, 250, 70,
                `Page ${this.pageIndex + 1}/${pageCount}`,
                "White", "",
                () => "Previous page",
                () => "Next page",
            );
            this.addClickHandler(() => {
                if (MouseIn(1530, 890, 250, 70)) {
                    const delta = MouseX < 1530 + 125 ? -1 : 1;
                    this.pageIndex = (this.pageIndex + delta + pageCount) % pageCount;
                }
            });
        }
    }
}
