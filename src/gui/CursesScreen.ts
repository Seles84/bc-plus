import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { ButtonActionWidget } from "@/system/gui/Widgets";
import { CurseSlotData } from "@/system/curses/CurseTypes";
import type { GUI } from "@/modules/GUI";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";
import type Curses from "@/modules/Curses";

const PER_PAGE = 6;

function groupLabel(curses: Curses, group: string): string {
    return curses.curseableGroups().find((g) => g.Name === group)?.Description ?? group;
}

export class CursesListScreen extends GUIScreen {

    get Title(): string {
        return "Curses";
    }

    private get curses(): Curses {
        return this.Module as Curses;
    }

    protected buildPages(): GUIPage[] {
        const slots = Object.values(this.curses.Slots);
        const pages: GUIPage[] = [];
        for (let i = 0; i < Math.max(1, Math.ceil(slots.length / PER_PAGE)); i++) {
            pages.push(new CursesListPage(this, slots.slice(i * PER_PAGE, (i + 1) * PER_PAGE)));
        }
        return pages;
    }
}

class CursesListPage extends GUIPage {

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

    render(): void {
        const canEdit = this.curses.canEdit();
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
    }
}

export class AddCurseScreen extends GUIScreen {

    constructor(module: Curses, character: BCPlusCharacter | null) {
        super(module, character);
    }

    get Title(): string {
        return "Curse a slot";
    }

    protected buildPages(): GUIPage[] {
        return [new AddCursePage(this)];
    }
}

class AddCursePage extends GUIPage {

    private index = 0;

    private get curses(): Curses {
        return this.Screen.Module as Curses;
    }

    get Config(): PageOptions {
        return {
            title: "Curse a slot",
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: "Browse to a slot and curse it. The slot's current state is captured: the worn "
                + "item becomes the first allowed item (in strict mode), an empty slot becomes cursed empty.",
        };
    }

    private candidates(): AssetGroup[] {
        return this.curses.curseableGroups().filter((g) => !this.curses.getSlot(g.Name));
    }

    render(): void {
        const groups = this.candidates();
        if (groups.length === 0) {
            DrawText("Every slot is already cursed.", 150, 250, "Gray");
            return;
        }
        this.index = Math.min(this.index, groups.length - 1);
        const group = groups[this.index]!;
        const worn = InventoryGet(Player, group.Name);

        DrawText("Slot:", 150, 332, "Black");
        MainCanvas.textAlign = "center";
        DrawBackNextButton(400, 300, 500, 64, group.Description, "White", "", () => "", () => "");
        MainCanvas.textAlign = "left";
        this.addClickHandler(() => {
            if (MouseIn(400, 300, 500, 64)) {
                const direction = MouseX < 650 ? -1 : 1;
                this.index = (this.index + direction + groups.length) % groups.length;
            }
        });

        DrawText(
            worn ? `Currently worn: ${worn.Craft?.Name || worn.Asset.Description}` : "Currently: empty",
            150, 450, "Gray",
        );

        MainCanvas.textAlign = "center";
        this.addClickHandler(ButtonActionWidget(
            { Left: 150, Top: 520, Width: 500, Height: 80 },
            {
                Name: worn ? "Curse with this item" : "Curse as empty",
                HoverText: worn ? "Only this exact item will be allowed" : "Nothing may be worn in this slot",
            },
            () => {
                this.curses.addCurse(group.Name);
                this.Screen.exit();
            },
        ));
        MainCanvas.textAlign = "left";
    }
}

export class CurseSlotScreen extends GUIScreen {

    constructor(module: Curses, character: BCPlusCharacter | null, private readonly group: string) {
        super(module, character);
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
        const slot = this.curses.getSlot(this.screen.Group);
        if (!slot) {
            this.Screen.exit();
            return;
        }
        const canEdit = this.curses.canEdit();

        DrawCheckbox(150, 200, 64, 64, "Curse is active", slot.active, !canEdit);
        this.addClickHandler(() => {
            if (canEdit && MouseIn(150, 200, 64, 64)) {
                this.curses.setActive(slot.group, !slot.active);
            }
        });

        DrawCheckbox(150, 280, 64, 64, "Slot may also be empty", slot.allowEmpty, !canEdit);
        this.addClickHandler(() => {
            if (canEdit && MouseIn(150, 280, 64, 64)) {
                slot.allowEmpty = !slot.allowEmpty;
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
                    spec.strict = !spec.strict;
                }
            });
            if (canEdit) {
                MainCanvas.textAlign = "center";
                DrawButton(1500, y, 60, 60, "X", "White", "", "Remove from allowed items");
                MainCanvas.textAlign = "left";
                this.addClickHandler(() => {
                    if (MouseIn(1500, y, 60, 60)) {
                        this.curses.removeItem(slot.group, i);
                    }
                });
            }
        });

        if (canEdit) {
            MainCanvas.textAlign = "center";
            this.addClickHandler(ButtonActionWidget(
                { Left: 150, Top: 790, Width: 520, Height: 80 },
                { Name: "Allow currently worn item", HoverText: "Adds what you are wearing in this slot to the allowed list" },
                () => {
                    this.curses.addCurrentItem(slot.group);
                },
            ));
            this.addClickHandler(ButtonActionWidget(
                { Left: 720, Top: 790, Width: 400, Height: 80 },
                { Name: "Remove this curse", HoverText: "Lifts the curse from this slot entirely" },
                () => {
                    this.curses.removeCurse(slot.group);
                    this.Screen.exit();
                },
            ));
            MainCanvas.textAlign = "left";
        }
    }
}
