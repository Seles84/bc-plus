import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { AssetPickerScreen } from "@/gui/AssetPickerScreen";
import { ButtonActionWidget } from "@/system/gui/Widgets";
import { LocalPunishmentAccess, PunishmentAccess, RemotePunishmentAccess } from "@/system/punishments/PunishmentAccess";
import {
    PUNISHMENT_LOCKS, PunishmentDefinition, RulePunishConfig,
    describeDuration, describeRemaining,
} from "@/system/punishments/PunishmentTypes";
import { ElementSetVisible } from "@/utils/BCUtils";
import type { GUI } from "@/modules/GUI";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";
import type { ModuleInstance } from "@/system/module/ModuleInstance";
import type Authority from "@/modules/Authority";
import type Curses from "@/modules/Curses";
import type Punishments from "@/modules/Punishments";
import type Rules from "@/modules/Rules";

const PER_PAGE = 4;
const RULES_PER_PAGE = 10;

function buildAccess(punishments: Punishments, character: BCPlusCharacter | null): PunishmentAccess {
    if (character && !character.isPlayer()) {
        const authority = punishments.ModuleManager.getModule<Authority>("authority");
        return new RemotePunishmentAccess(authority, character);
    }
    return new LocalPunishmentAccess(punishments);
}

function groupLabel(module: ModuleInstance, group: string | undefined): string {
    if (!group) {
        return "?";
    }
    return module.ModuleManager.getModule<Curses>("curses")
        ?.curseableGroups().find((g) => g.Name === group)?.Description ?? group;
}

function describeDefinition(module: ModuleInstance, definition: PunishmentDefinition): string {
    const duration = describeDuration(definition.durationMin);
    if (definition.kind === "rule") {
        const rule = module.ModuleManager.getModule<Rules>("rules")?.getDefinition(definition.rule ?? "");
        return `Forces "${rule?.name ?? definition.rule ?? "?"}" - ${duration}`;
    }
    const lock = PUNISHMENT_LOCKS.find((l) => l.asset === (definition.lock ?? ""));
    const lockText = lock && lock.asset !== "" ? `, ${lock.label.toLocaleLowerCase()}` : "";
    return `${groupLabel(module, definition.group)} - ${duration}${lockText}`;
}

/** Reopens the screen when fresh data for the viewed character arrives. */
function listenForSync(screen: GUIScreen): (() => void) | null {
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

export class PunishmentsListScreen extends GUIScreen {

    readonly access: PunishmentAccess;

    constructor(module: Punishments, character: BCPlusCharacter | null) {
        super(module, character);
        this.access = buildAccess(module, character);
    }

    get Title(): string {
        return this.Character && !this.Character.isPlayer()
            ? `Punishments - ${this.Character.Nickname}`
            : "Punishments";
    }

    protected buildPages(): GUIPage[] {
        const ids = Object.keys(this.access.definitions());
        const pages: GUIPage[] = [];
        for (let i = 0; i < Math.max(1, Math.ceil(ids.length / PER_PAGE)); i++) {
            pages.push(new PunishmentsListPage(this, ids.slice(i * PER_PAGE, (i + 1) * PER_PAGE)));
        }
        return pages;
    }
}

class PunishmentsListPage extends GUIPage {

    private removeListener: (() => void) | null = null;

    constructor(protected override readonly screen: PunishmentsListScreen, private readonly ids: string[]) {
        super(screen);
    }

    private get punishments(): Punishments {
        return this.screen.Module as Punishments;
    }

    get Config(): PageOptions {
        return {
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: this.punishments.Config.HoverText,
        };
    }

    override async create(): Promise<void> {
        this.removeListener = listenForSync(this.screen);
    }

    override async destroy(): Promise<void> {
        this.removeListener?.();
        this.removeListener = null;
    }

    render(): void {
        const access = this.screen.access;
        const canEdit = access.canEdit();
        const canLift = access.canLift();

        // Running punishments (live; shown on every page)
        DrawText("Running punishments:", 150, 210, "Black");
        const active = Object.values(access.active());
        if (active.length === 0) {
            DrawText("None.", 180, 265, "Gray");
        }
        active.slice(0, 3).forEach((entry, i) => {
            const y = 240 + i * 70;
            DrawTextFit(entry.name, 180, y + 30, 700, "Black");
            const rules = this.Core.ModuleManager.getModule<Rules>("rules");
            const source = entry.sourceRule === "manual"
                ? "applied directly"
                : `broke "${rules?.getDefinition(entry.sourceRule)?.name ?? entry.sourceRule}"`;
            DrawTextFit(`${source} - ${describeRemaining(entry)}`, 900, y + 30, 550, "Gray");
            if (canLift) {
                MainCanvas.textAlign = "center";
                this.addClickHandler(ButtonActionWidget(
                    { Left: 1520, Top: y, Width: 200, Height: 60 },
                    { Name: "Lift", HoverText: "End this punishment now" },
                    () => this.screen.access.lift(entry.punishment),
                ));
                MainCanvas.textAlign = "left";
            }
        });
        if (active.length > 3) {
            DrawText(`...and ${active.length - 3} more.`, 180, 480, "Gray");
        }

        // Defined punishments
        DrawText("Defined punishments:", 150, 500, "Black");
        if (this.ids.length === 0) {
            DrawText("None yet - create one below.", 180, 555, "Gray");
        }
        this.ids.forEach((id, i) => {
            const definition = access.definitions()[id];
            if (!definition) {
                return;
            }
            const y = 530 + i * 85;
            this.addClickHandler(ButtonActionWidget(
                { Left: 150, Top: y, Width: 850, Height: 70 },
                { Name: definition.name, HoverText: "Configure this punishment" },
                () => {
                    this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(
                        new PunishmentConfigScreen(this.punishments, this.Character, id),
                    );
                },
            ));
            DrawTextFit(describeDefinition(this.screen.Module, definition), 1050, y + 35, 650, "Gray");
        });

        if (canEdit) {
            MainCanvas.textAlign = "center";
            this.addClickHandler(ButtonActionWidget(
                { Left: 150, Top: 880, Width: 450, Height: 70 },
                { Name: "New from worn item...", HoverText: "Turn an item currently worn into a punishment" },
                () => {
                    this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(
                        new AddPunishmentItemScreen(this.punishments, this.Character, "worn"),
                    );
                },
            ));
            this.addClickHandler(ButtonActionWidget(
                { Left: 650, Top: 880, Width: 450, Height: 70 },
                { Name: "New from catalog...", HoverText: "Pick any item as a punishment - nothing has to be worn" },
                () => {
                    this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(
                        new AddPunishmentItemScreen(this.punishments, this.Character, "catalog"),
                    );
                },
            ));
            this.addClickHandler(ButtonActionWidget(
                { Left: 1150, Top: 880, Width: 450, Height: 70 },
                { Name: "New rule punishment...", HoverText: "A punishment that forces another rule for a while" },
                () => {
                    this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(
                        new ChooseRulePunishmentScreen(this.punishments, this.Character),
                    );
                },
            ));
            MainCanvas.textAlign = "left";
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

export class AddPunishmentItemScreen extends GUIScreen {

    readonly access: PunishmentAccess;

    constructor(
        module: Punishments,
        character: BCPlusCharacter | null,
        readonly mode: "worn" | "catalog" = "worn",
    ) {
        super(module, character);
        this.access = buildAccess(module, character);
    }

    get Title(): string {
        return "New item punishment";
    }

    protected buildPages(): GUIPage[] {
        const groups = this.Module.ModuleManager.getModule<Curses>("curses")?.curseableGroups() ?? [];
        const categories: { label: string; groups: AssetGroup[] }[] = [
            { label: "Items", groups: groups.filter((g) => g.Category === "Item") },
            { label: "Clothing", groups: groups.filter((g) => g.Category === "Appearance") },
        ];
        const pages: GUIPage[] = [];
        for (const category of categories) {
            for (let i = 0; i < Math.max(1, Math.ceil(category.groups.length / PER_GRID_PAGE)); i++) {
                pages.push(new PunishmentSlotGridPage(this, category.label, category.groups.slice(i * PER_GRID_PAGE, (i + 1) * PER_GRID_PAGE)));
            }
        }
        return pages;
    }
}

class PunishmentSlotGridPage extends GUIPage {

    constructor(
        protected override readonly screen: AddPunishmentItemScreen,
        private readonly category: string,
        private readonly groups: AssetGroup[],
    ) {
        super(screen);
    }

    get Config(): PageOptions {
        return {
            title: `New item punishment - ${this.category}`,
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: this.screen.mode === "catalog"
                ? "Click a slot, then pick any item for it from the catalog - nothing has to be "
                + "worn. Catalog punishments apply the item in its default color and configuration. "
                + "Use the page arrows to switch between item and clothing slots."
                : "Click a slot to capture the item currently worn there as a punishment - wear "
                + "and configure the item (color, type, crafting) the way the punishment should apply "
                + "it first. Empty slots cannot become punishments. Use the page arrows to switch "
                + "between item and clothing slots.",
        };
    }

    render(): void {
        if (this.screen.mode === "catalog") {
            this.renderCatalogGrid();
        } else {
            this.renderWornGrid();
        }
    }

    private renderWornGrid(): void {
        const access = this.screen.access;
        MainCanvas.textAlign = "center";
        this.groups.forEach((group, i) => {
            const x = GRID_LEFT + (i % GRID_COLS) * GRID_CELL_W;
            const y = GRID_TOP + Math.floor(i / GRID_COLS) * GRID_CELL_H;
            const worn = InventoryGet(access.subject(), group.Name);
            const wornLabel = worn ? (worn.Craft?.Name || worn.Asset.Description) : "empty";
            DrawButton(
                x, y, GRID_BUTTON_W, GRID_BUTTON_H,
                group.Description,
                worn ? "White" : "#ddd",
                "",
                worn ? `Capture: ${wornLabel}` : "Nothing worn here",
                !worn,
            );
            this.addClickHandler(() => {
                if (worn && MouseIn(x, y, GRID_BUTTON_W, GRID_BUTTON_H)) {
                    access.createFromWorn(group.Name);
                    this.Screen.exit();
                }
            });
        });
        MainCanvas.textAlign = "left";
    }

    private renderCatalogGrid(): void {
        MainCanvas.textAlign = "center";
        this.groups.forEach((group, i) => {
            const x = GRID_LEFT + (i % GRID_COLS) * GRID_CELL_W;
            const y = GRID_TOP + Math.floor(i / GRID_COLS) * GRID_CELL_H;
            DrawButton(x, y, GRID_BUTTON_W, GRID_BUTTON_H, group.Description, "White", "", "Browse items for this slot");
            this.addClickHandler(() => {
                if (MouseIn(x, y, GRID_BUTTON_W, GRID_BUTTON_H)) {
                    this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(new AssetPickerScreen(
                        this.screen.Module,
                        this.Character,
                        {
                            title: `New punishment - ${group.Description}`,
                            group: group.Name,
                            helpText: "Click an item to create a punishment applying it. Catalog picks "
                                + "apply the item in its default color and configuration; to punish with "
                                + "an exactly configured item, wear it and use 'New from worn item' instead.",
                            pick: (asset) => this.screen.access.createFromCatalog(group.Name, asset.Name),
                        },
                    ));
                }
            });
        });
        MainCanvas.textAlign = "left";
    }
}

export class ChooseRulePunishmentScreen extends GUIScreen {

    readonly access: PunishmentAccess;

    constructor(module: Punishments, character: BCPlusCharacter | null) {
        super(module, character);
        this.access = buildAccess(module, character);
    }

    get Title(): string {
        return "New rule punishment";
    }

    protected buildPages(): GUIPage[] {
        const rules = this.Module.ModuleManager.getModule<Rules>("rules")?.Definitions ?? [];
        const sorted = [...rules].sort((a, b) => a.category === b.category
            ? a.name.localeCompare(b.name)
            : a.category.localeCompare(b.category));
        const pages: GUIPage[] = [];
        for (let i = 0; i < Math.max(1, Math.ceil(sorted.length / RULES_PER_PAGE)); i++) {
            pages.push(new ChooseRulePage(this, sorted.slice(i * RULES_PER_PAGE, (i + 1) * RULES_PER_PAGE)));
        }
        return pages;
    }
}

class ChooseRulePage extends GUIPage {

    constructor(
        protected override readonly screen: ChooseRulePunishmentScreen,
        private readonly rules: { id: string; name: string; category: string }[],
    ) {
        super(screen);
    }

    get Config(): PageOptions {
        return {
            title: this.screen.Title,
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: "Pick the rule this punishment forces. While the punishment runs, the rule is "
                + "active, enforced and unconditional (its own conditions are ignored), and cannot be "
                + "switched off. When the punishment ends, the rule returns to how it was before.",
        };
    }

    render(): void {
        this.rules.forEach((rule, i) => {
            const y = 200 + i * 75;
            this.addClickHandler(ButtonActionWidget(
                { Left: 150, Top: y, Width: 1100, Height: 64 },
                { Name: rule.name, HoverText: "Create a punishment forcing this rule" },
                () => {
                    this.screen.access.createRule(rule.id);
                    this.Screen.exit();
                },
            ));
            DrawText(rule.category, 1300, y + 32, "Gray");
        });
    }
}

export class PunishmentConfigScreen extends GUIScreen {

    readonly access: PunishmentAccess;

    constructor(module: Punishments, character: BCPlusCharacter | null, private readonly id: string) {
        super(module, character);
        this.access = buildAccess(module, character);
    }

    get Title(): string {
        return `Punishment - ${this.access.definitions()[this.id]?.name ?? "?"}`;
    }

    get Id(): string {
        return this.id;
    }

    protected buildPages(): GUIPage[] {
        return [new PunishmentConfigPage(this)];
    }
}

const NAME_INPUT = "BCP_punishment_name";
const DURATION_INPUT = "BCP_punishment_duration";

class PunishmentConfigPage extends GUIPage {

    private removeListener: (() => void) | null = null;

    constructor(protected override readonly screen: PunishmentConfigScreen) {
        super(screen);
    }

    get Config(): PageOptions {
        return {
            title: this.screen.Title,
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: (this.screen.Module as Punishments).Config.HoverText,
        };
    }

    override async create(): Promise<void> {
        this.removeListener = listenForSync(this.screen);
        const definition = this.screen.access.definitions()[this.screen.Id];
        const name = ElementCreateInput(NAME_INPUT, "text", definition?.name ?? "", "40");
        name.addEventListener("change", () => {
            if (name.value.trim().length > 0) {
                this.screen.access.setName(this.screen.Id, name.value);
            }
        });
        const duration = ElementCreateInput(DURATION_INPUT, "text", String(definition?.durationMin ?? 0), "4");
        duration.addEventListener("change", () => {
            const minutes = Number.parseInt(duration.value, 10);
            if (Number.isInteger(minutes) && minutes >= 0 && minutes <= 4320) {
                this.screen.access.setDuration(this.screen.Id, minutes);
            }
        });
    }

    override async destroy(): Promise<void> {
        this.removeListener?.();
        this.removeListener = null;
        ElementRemove(NAME_INPUT);
        ElementRemove(DURATION_INPUT);
    }

    render(): void {
        const access = this.screen.access;
        const definition = access.definitions()[this.screen.Id];
        if (!definition) {
            // Deleted elsewhere, or the remote mirror has not arrived yet
            DrawText("Waiting for punishment data...", 150, 250, "Gray");
            return;
        }
        const canEdit = access.canEdit();
        const helpOpen = this.screen.HelpVisible;

        DrawText("Name:", 150, 232, "Black");
        const nameInput = document.getElementById(NAME_INPUT) as HTMLInputElement | null;
        if (nameInput) {
            nameInput.disabled = !canEdit;
        }
        ElementSetVisible(NAME_INPUT, !helpOpen);
        ElementPosition(NAME_INPUT, 700, 227, 700, 60);

        DrawText("Duration in minutes (0 = until lifted):", 150, 312, "Black");
        const durationInput = document.getElementById(DURATION_INPUT) as HTMLInputElement | null;
        if (durationInput) {
            durationInput.disabled = !canEdit;
        }
        ElementSetVisible(DURATION_INPUT, !helpOpen);
        ElementPosition(DURATION_INPUT, 950, 307, 200, 60);
        DrawText(describeDuration(definition.durationMin), 1100, 312, "Gray");

        if (definition.kind === "item") {
            DrawTextFit(`Item: ${definition.item?.name ?? "?"} (${groupLabel(this.screen.Module, definition.group)})`, 150, 412, 1000, "Black");

            const lockIndex = Math.max(0, PUNISHMENT_LOCKS.findIndex((l) => l.asset === (definition.lock ?? "")));
            DrawText("Lock:", 150, 492, "Black");
            MainCanvas.textAlign = "center";
            DrawBackNextButton(450, 460, 400, 64, PUNISHMENT_LOCKS[lockIndex]!.label,
                canEdit ? "White" : "#ddd", "", () => "", () => "", !canEdit);
            MainCanvas.textAlign = "left";
            this.addClickHandler(() => {
                if (!canEdit || !MouseIn(450, 460, 400, 64)) {
                    return;
                }
                const direction = MouseX < 450 + 200 ? -1 : 1;
                const next = PUNISHMENT_LOCKS[(lockIndex + direction + PUNISHMENT_LOCKS.length) % PUNISHMENT_LOCKS.length]!;
                access.setLock(this.screen.Id, next.asset);
            });
        } else {
            const rule = this.Core.ModuleManager.getModule<Rules>("rules")?.getDefinition(definition.rule ?? "");
            DrawTextFit(`Forces the rule: ${rule?.name ?? definition.rule ?? "?"}`, 150, 412, 1000, "Black");
            DrawTextFit("While the punishment runs, the rule is enforced unconditionally and cannot be switched off.", 150, 462, 1400, "Gray");
        }

        DrawCheckbox(150, 560, 64, 64, "Announce this punishment in chat", definition.announce, !canEdit);
        this.addClickHandler(() => {
            if (canEdit && MouseIn(150, 560, 64, 64)) {
                access.setAnnounce(this.screen.Id, !definition.announce);
            }
        });

        if (definition.addedBy) {
            DrawTextFit(`Created by ${definition.addedBy.name} (#${definition.addedBy.member})`, 150, 680, 800, "Gray");
        }

        const running = access.active()[this.screen.Id] !== undefined;
        if (running) {
            DrawText("This punishment is running right now.", 150, 740, "#A00000");
        }

        if (canEdit) {
            MainCanvas.textAlign = "center";
            this.addClickHandler(ButtonActionWidget(
                { Left: 150, Top: 800, Width: 400, Height: 70 },
                { Name: "Apply now", Active: !running, HoverText: "Punish immediately, without a rule violation" },
                () => access.apply(this.screen.Id),
            ));
            this.addClickHandler(ButtonActionWidget(
                { Left: 600, Top: 800, Width: 450, Height: 70 },
                { Name: "Delete punishment", HoverText: "Removes the definition; a running punishment continues until it ends" },
                () => {
                    access.remove(this.screen.Id);
                    this.Screen.exit();
                },
            ));
            MainCanvas.textAlign = "left";
        }
    }
}

/** Adapter the rule config screen provides for editing a rule's punishment attachment. */
export interface PunishTarget {
    /** Rule name, for the title */
    label: string;
    get(): RulePunishConfig;
    set(config: RulePunishConfig): void;
    canEdit(): boolean;
    /** The punishment definitions to offer (local, or the target's mirror) */
    definitions(): Record<string, PunishmentDefinition>;
}

const THRESHOLDS = [1, 2, 3, 5, 10, 15, 20];
const WINDOWS = [1, 2, 5, 10, 15, 30, 60];
const REPEATS: readonly { value: RulePunishConfig["repeat"]; label: string }[] = [
    { value: "stack", label: "Add time" },
    { value: "restart", label: "Restart timer" },
    { value: "ignore", label: "Ignore" },
];

export class RulePunishScreen extends GUIScreen {

    constructor(module: ModuleInstance, character: BCPlusCharacter | null, readonly target: PunishTarget) {
        super(module, character);
    }

    get Title(): string {
        return `Punishments - ${this.target.label}`;
    }

    protected buildPages(): GUIPage[] {
        return [new RulePunishPage(this)];
    }
}

class RulePunishPage extends GUIPage {

    private removeListener: (() => void) | null = null;

    constructor(protected override readonly screen: RulePunishScreen) {
        super(screen);
    }

    get Config(): PageOptions {
        return {
            title: this.screen.Title,
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: "The ticked punishments are applied when this rule reaches the violation "
                + "threshold: N violations within the time window (1 = every violation). The repeat "
                + "setting decides what further violations do while a punishment is already running: "
                + "add the full duration on top, restart the timer, or do nothing. Punishments are "
                + "defined on the Punishments page.",
        };
    }

    override async create(): Promise<void> {
        this.removeListener = listenForSync(this.screen);
    }

    override async destroy(): Promise<void> {
        this.removeListener?.();
        this.removeListener = null;
    }

    private update(change: Partial<RulePunishConfig>): void {
        this.screen.target.set({ ...this.screen.target.get(), ...change });
    }

    render(): void {
        const target = this.screen.target;
        const config = target.get();
        const canEdit = target.canEdit();
        const definitions = Object.values(target.definitions());

        DrawText("Punishments applied when this rule is broken:", 150, 210, "Black");
        if (definitions.length === 0) {
            DrawText("No punishments defined yet - create them on the Punishments page.", 180, 270, "Gray");
        }
        definitions.slice(0, 7).forEach((definition, i) => {
            const y = 250 + i * 75;
            const checked = config.punishments.includes(definition.id);
            DrawCheckbox(180, y, 64, 64, definition.name, checked, !canEdit);
            DrawTextFit(describeDefinition(this.screen.Module, definition), 1100, y + 32, 650, "Gray");
            this.addClickHandler(() => {
                if (canEdit && MouseIn(180, y, 64, 64)) {
                    this.update({
                        punishments: checked
                            ? config.punishments.filter((p) => p !== definition.id)
                            : [...config.punishments, definition.id],
                    });
                }
            });
        });
        if (definitions.length > 7) {
            DrawText(`...and ${definitions.length - 7} more (only the first 7 are shown).`, 180, 780, "Gray");
        }

        const cycles: { label: string; value: string; hover: string; click: (direction: -1 | 1) => void }[] = [
            {
                label: "Punish after",
                value: `${config.threshold} violation${config.threshold === 1 ? "" : "s"}`,
                hover: "How many violations within the window trigger the punishment",
                click: (direction) => {
                    const index = THRESHOLDS.indexOf(config.threshold);
                    this.update({ threshold: THRESHOLDS[(index + direction + THRESHOLDS.length) % THRESHOLDS.length] });
                },
            },
            {
                label: "within",
                value: `${config.windowMin} min`,
                hover: "The rolling time window violations are counted in",
                click: (direction) => {
                    const index = WINDOWS.indexOf(config.windowMin);
                    this.update({ windowMin: WINDOWS[(index + direction + WINDOWS.length) % WINDOWS.length] });
                },
            },
            {
                label: "While running",
                value: REPEATS.find((r) => r.value === config.repeat)?.label ?? "Add time",
                hover: "What further violations do while the punishment is already running",
                click: (direction) => {
                    const index = REPEATS.findIndex((r) => r.value === config.repeat);
                    this.update({ repeat: REPEATS[(index + direction + REPEATS.length) % REPEATS.length]!.value });
                },
            },
        ];
        cycles.forEach((cycle, i) => {
            const y = 830;
            const x = 150 + i * 580;
            DrawText(cycle.label, x, y + 32, "Black");
            MainCanvas.textAlign = "center";
            DrawBackNextButton(x + 240, y, 320, 64, cycle.value, canEdit ? "White" : "#ddd", "",
                () => cycle.hover, () => cycle.hover, !canEdit);
            MainCanvas.textAlign = "left";
            this.addClickHandler(() => {
                if (canEdit && MouseIn(x + 240, y, 320, 64)) {
                    cycle.click(MouseX < x + 240 + 160 ? -1 : 1);
                }
            });
        });
    }
}
