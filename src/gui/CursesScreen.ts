import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { ButtonActionWidget } from "@/system/gui/Widgets";
import { CurseAccess, LocalCurseAccess, RemoteCurseAccess } from "@/system/curses/CurseAccess";
import { CurseSlotData } from "@/system/curses/CurseTypes";
import type { GUI } from "@/modules/GUI";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";
import type Authority from "@/modules/Authority";
import type Curses from "@/modules/Curses";

const PER_PAGE = 6;

function buildAccess(curses: Curses, character: BCPlusCharacter | null): CurseAccess {
    if (character && !character.isPlayer()) {
        const authority = curses.ModuleManager.getModule<Authority>("authority");
        return new RemoteCurseAccess(curses, authority, character);
    }
    return new LocalCurseAccess(curses);
}

function groupLabel(curses: Curses, group: string): string {
    return curses.curseableGroups().find((g) => g.Name === group)?.Description ?? group;
}

/** Reopens the screen when fresh data for the viewed character arrives. */
function listenForSync(page: GUIPage, screen: GUIScreen): (() => void) | null {
    const character = screen.Character;
    if (!character || character.isPlayer()) {
        return null;
    }
    return screen.Core.Events.on("characterSyncReceived", ({ memberNumber }) => {
        if (memberNumber === character.MemberNumber) {
            screen.reopen();
        }
    });
}

export class CursesListScreen extends GUIScreen {

    readonly access: CurseAccess;

    constructor(module: Curses, character: BCPlusCharacter | null) {
        super(module, character);
        this.access = buildAccess(module, character);
    }

    get Title(): string {
        return this.Character && !this.Character.isPlayer()
            ? `Curses - ${this.Character.Nickname}`
            : "Curses";
    }

    protected buildPages(): GUIPage[] {
        const slots = Object.values(this.access.slots());
        const pages: GUIPage[] = [];
        for (let i = 0; i < Math.max(1, Math.ceil(slots.length / PER_PAGE)); i++) {
            pages.push(new CursesListPage(this, slots.slice(i * PER_PAGE, (i + 1) * PER_PAGE)));
        }
        return pages;
    }
}

class CursesListPage extends GUIPage {

    private removeListener: (() => void) | null = null;

    constructor(protected override readonly screen: CursesListScreen, private readonly slots: CurseSlotData[]) {
        super(screen);
    }

    private get curses(): Curses {
        return this.screen.Module as Curses;
    }

    get Config(): PageOptions {
        return {
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: this.curses.Config.HoverText,
        };
    }

    override async create(): Promise<void> {
        this.removeListener = listenForSync(this, this.screen);
    }

    override async destroy(): Promise<void> {
        this.removeListener?.();
        this.removeListener = null;
    }

    render(): void {
        const access = this.screen.access;
        const canEdit = access.canEdit();
        if (this.slots.length === 0) {
            DrawText("No slots are cursed yet.", 150, 250, "Gray");
        }
        this.slots.forEach((slot, i) => {
            const y = 220 + i * 110;
            const summary = slot.items.length === 0
                ? (slot.allowEmpty ? "Cursed empty" : "Empty (inactive)")
                : `${slot.items.length} allowed item${slot.items.length === 1 ? "" : "s"}${slot.allowEmpty ? ", may be empty" : ""}`;
            this.addClickHandler(ButtonActionWidget(
                { Left: 150, Top: y, Width: 1100, Height: 90 },
                { Name: groupLabel(this.curses, slot.group), HoverText: "Configure this curse" },
                () => {
                    this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(
                        new CurseSlotScreen(this.curses, this.Character, slot.group),
                    );
                },
            ));
            DrawText(slot.active ? "Active" : "Inactive", 1330, y + 45, slot.active ? "Green" : "Gray");
            DrawText(summary, 1450, y + 45, "Gray");
        });

        if (canEdit) {
            MainCanvas.textAlign = "center";
            this.addClickHandler(ButtonActionWidget(
                { Left: 150, Top: 870, Width: 400, Height: 80 },
                { Name: "Curse a slot...", HoverText: "Pick a clothing or item slot to curse" },
                () => {
                    this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(
                        new AddCurseScreen(this.curses, this.Character),
                    );
                },
            ));
            MainCanvas.textAlign = "left";
        }

        // Personal preference, shown only on your own curses screen
        if (!this.Character || this.Character.isPlayer()) {
            const announce = this.curses.Data.announce !== false;
            DrawCheckbox(650, 878, 64, 64, "Announce curse activity in chat", announce, !canEdit);
            this.addClickHandler(() => {
                if (canEdit && MouseIn(650, 878, 64, 64)) {
                    this.curses.Data.announce = !announce;
                }
            });
        }
    }
}

const GRID_COLS = 4;
const GRID_CELL_W = 410;
const GRID_CELL_H = 85;
const GRID_BUTTON_W = 390;
const GRID_BUTTON_H = 70;
const GRID_LEFT = 150;
const GRID_TOP = 220;
const GRID_ROWS = 8;
const PER_GRID_PAGE = GRID_COLS * GRID_ROWS;

export class AddCurseScreen extends GUIScreen {

    readonly access: CurseAccess;

    constructor(module: Curses, character: BCPlusCharacter | null) {
        super(module, character);
        this.access = buildAccess(module, character);
    }

    get Title(): string {
        return "Curse a slot";
    }

    protected buildPages(): GUIPage[] {
        const curses = this.Module as Curses;
        const categories: { label: string; groups: AssetGroup[] }[] = [
            { label: "Items", groups: curses.curseableGroups().filter((g) => g.Category === "Item") },
            { label: "Clothing", groups: curses.curseableGroups().filter((g) => g.Category === "Appearance") },
        ];
        const pages: GUIPage[] = [];
        for (const category of categories) {
            for (let i = 0; i < Math.max(1, Math.ceil(category.groups.length / PER_GRID_PAGE)); i++) {
                pages.push(new SlotGridPage(this, category.label, category.groups.slice(i * PER_GRID_PAGE, (i + 1) * PER_GRID_PAGE)));
            }
        }
        return pages;
    }
}

class SlotGridPage extends GUIPage {

    constructor(
        protected override readonly screen: AddCurseScreen,
        private readonly category: string,
        private readonly groups: AssetGroup[],
    ) {
        super(screen);
    }

    private get curses(): Curses {
        return this.screen.Module as Curses;
    }

    get Config(): PageOptions {
        return {
            title: `Curse a slot - ${this.category}`,
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: "Click a slot to curse it. The slot's current state is captured: the worn item "
                + "becomes the first allowed item (in strict mode), an empty slot becomes cursed empty. "
                + "Slots that are already cursed are greyed out. Use the page arrows to switch between "
                + "item and clothing slots.",
        };
    }

    render(): void {
        const access = this.screen.access;
        MainCanvas.textAlign = "center";
        this.groups.forEach((group, i) => {
            const x = GRID_LEFT + (i % GRID_COLS) * GRID_CELL_W;
            const y = GRID_TOP + Math.floor(i / GRID_COLS) * GRID_CELL_H;
            const cursed = access.slot(group.Name) !== undefined;
            const worn = InventoryGet(access.subject(), group.Name);
            const wornLabel = worn ? (worn.Craft?.Name || worn.Asset.Description) : "empty";
            DrawButton(
                x, y, GRID_BUTTON_W, GRID_BUTTON_H,
                group.Description,
                cursed ? "#ddd" : "White",
                "",
                cursed ? "Already cursed" : `Currently: ${wornLabel} - click to curse`,
                cursed,
            );
            this.addClickHandler(() => {
                if (!cursed && MouseIn(x, y, GRID_BUTTON_W, GRID_BUTTON_H)) {
                    access.addCurse(group.Name);
                    this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(
                        new CurseSlotScreen(this.curses, this.Character, group.Name),
                    );
                }
            });
        });
        MainCanvas.textAlign = "left";
    }
}

export class CurseSlotScreen extends GUIScreen {

    readonly access: CurseAccess;

    constructor(module: Curses, character: BCPlusCharacter | null, private readonly group: string) {
        super(module, character);
        this.access = buildAccess(module, character);
    }

    get Title(): string {
        return `Curse - ${groupLabel(this.Module as Curses, this.group)}`;
    }

    get Group(): string {
        return this.group;
    }

    protected buildPages(): GUIPage[] {
        return [new CurseSlotPage(this)];
    }
}

class CurseSlotPage extends GUIPage {

    constructor(protected override readonly screen: CurseSlotScreen) {
        super(screen);
    }

    private get curses(): Curses {
        return this.screen.Module as Curses;
    }

    get Config(): PageOptions {
        return {
            title: this.screen.Title,
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: this.curses.Config.HoverText,
        };
    }

    render(): void {
        const access = this.screen.access;
        const slot = access.slot(this.screen.Group);
        if (!slot) {
            // Remote curses appear in the mirror only after the target's
            // change-broadcast arrives; also covers a curse removed elsewhere
            DrawText("Waiting for curse data...", 150, 250, "Gray");
            return;
        }
        const canEdit = access.canEdit();

        DrawCheckbox(150, 200, 64, 64, "Curse is active", slot.active, !canEdit);
        this.addClickHandler(() => {
            if (canEdit && MouseIn(150, 200, 64, 64)) {
                access.setActive(slot.group, !slot.active);
            }
        });

        DrawCheckbox(150, 280, 64, 64, "Slot may also be empty", slot.allowEmpty, !canEdit);
        this.addClickHandler(() => {
            if (canEdit && MouseIn(150, 280, 64, 64)) {
                access.setAllowEmpty(slot.group, !slot.allowEmpty);
            }
        });

        DrawText("Allowed items (each with its own rules):", 150, 400, "Black");
        if (slot.items.length === 0) {
            DrawText("None - the slot is cursed empty.", 150, 460, "Gray");
        }
        slot.items.forEach((spec, i) => {
            const y = 430 + i * 80;
            DrawText(spec.name, 180, y + 32, "Black");
            DrawCheckbox(900, y, 64, 64, "Strict (exact state)", spec.strict, !canEdit);
            this.addClickHandler(() => {
                if (canEdit && MouseIn(900, y, 64, 64)) {
                    access.setStrict(slot.group, i, !spec.strict);
                }
            });
            if (canEdit) {
                MainCanvas.textAlign = "center";
                DrawButton(1500, y, 60, 60, "X", "White", "", "Remove from allowed items");
                MainCanvas.textAlign = "left";
                this.addClickHandler(() => {
                    if (MouseIn(1500, y, 60, 60)) {
                        access.removeItem(slot.group, i);
                    }
                });
            }
        });

        if (canEdit) {
            MainCanvas.textAlign = "center";
            this.addClickHandler(ButtonActionWidget(
                { Left: 150, Top: 790, Width: 520, Height: 80 },
                { Name: "Allow currently worn item", HoverText: "Adds what is worn in this slot to the allowed list" },
                () => {
                    access.addCurrentItem(slot.group);
                },
            ));
            this.addClickHandler(ButtonActionWidget(
                { Left: 720, Top: 790, Width: 400, Height: 80 },
                { Name: "Remove this curse", HoverText: "Lifts the curse from this slot entirely" },
                () => {
                    access.removeCurse(slot.group);
                    this.Screen.exit();
                },
            ));
            MainCanvas.textAlign = "left";
        }
    }
}
