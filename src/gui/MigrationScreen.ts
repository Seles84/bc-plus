import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { ButtonActionWidget } from "@/system/gui/Widgets";
import {
    CurseMigrationItem,
    MigrationPlan,
    RuleMigrationItem,
    applyMigration,
    scanBCXMigration,
} from "@/system/migration/BCXMigration";
import { describeConditions } from "@/system/conditions/Conditions";
import { modalConfirm, modalInfo } from "@/gui/Modal";
import type Rules from "@/modules/Rules";
import type Curses from "@/modules/Curses";
import type { ModuleInstance } from "@/system/module/ModuleInstance";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";

const PER_PAGE = 7;

type MigrationRow =
    | { header: string }
    | { item: RuleMigrationItem | CurseMigrationItem }
    | { unmapped: { bcxId: string; name: string } };

/**
 * BCX -> BC+ migration wizard: shows everything configured in BCX with a
 * checkbox per item, and applies the selection to the player's own BC+
 * config. Read-only towards BCX - tandem deferral keeps the migrated BC+
 * rules paused until BCX's own rules are switched off.
 */
export class MigrationScreen extends GUIScreen {

    plan: MigrationPlan | null = null;
    readonly selected = new Set<string>();

    constructor(module: ModuleInstance, character: BCPlusCharacter | null) {
        super(module, character);
        const rules = module.ModuleManager.getModule<Rules>("rules");
        const api = module.SDK.bcxAPI();
        if (rules && api) {
            try {
                this.plan = scanBCXMigration(rules, module.ModuleManager.getModule<Curses>("curses"), api);
            } catch {
                this.plan = null;
            }
            // Preselect everything that is sensible to migrate
            for (const item of this.plan?.rules ?? []) {
                if (!item.locked && !item.alreadyActive && item.bcxActive) {
                    this.selected.add(this.key(item));
                }
            }
            for (const item of this.plan?.curses ?? []) {
                if (!item.alreadyCursed) {
                    this.selected.add(this.key(item));
                }
            }
        }
    }

    get Title(): string {
        return "Migrate from BCX";
    }

    key(item: RuleMigrationItem | CurseMigrationItem): string {
        return item.kind === "rule" ? `rule:${item.bcpId}` : `curse:${item.group}`;
    }

    protected buildPages(): GUIPage[] {
        const rows: MigrationRow[] = [];
        if (this.plan) {
            if (this.plan.rules.length > 0) {
                rows.push({ header: `Rules (${this.plan.rules.length})` });
                rows.push(...this.plan.rules.map((item) => ({ item })));
            }
            if (this.plan.curses.length > 0) {
                rows.push({ header: `Curses (${this.plan.curses.length})` });
                rows.push(...this.plan.curses.map((item) => ({ item })));
            }
            if (this.plan.unmapped.length > 0) {
                rows.push({ header: `No BC+ counterpart - stays in BCX (${this.plan.unmapped.length})` });
                rows.push(...this.plan.unmapped.map((unmapped) => ({ unmapped })));
            }
        }
        const pages: GUIPage[] = [];
        for (let i = 0; i < Math.max(1, Math.ceil(rows.length / PER_PAGE)); i++) {
            pages.push(new MigrationPage(this, rows.slice(i * PER_PAGE, (i + 1) * PER_PAGE)));
        }
        return pages;
    }
}

class MigrationPage extends GUIPage {

    constructor(protected override readonly screen: MigrationScreen, private readonly rows: MigrationRow[]) {
        super(screen);
    }

    get Config(): PageOptions {
        return {
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: "Everything configured in your BCX, ready to copy into BC+. Ticked items are "
                + "applied when you press Migrate: rules carry their on/off state, enforcement, "
                + "logging, timers and conditions, and settings where they translate ('review "
                + "settings' means BC+ starts with defaults there - check the rule afterwards). "
                + "Nothing in BCX is changed, and while a BCX rule is still in effect the migrated "
                + "BC+ twin politely defers to it - switch off BCX rules (or BCX) whenever you are "
                + "ready and BC+ takes over instantly.",
        };
    }

    render(): void {
        const screen = this.screen;
        const plan = screen.plan;
        const rules = this.Core.ModuleManager.getModule<Rules>("rules");
        const curses = this.Core.ModuleManager.getModule<Curses>("curses");

        MainCanvas.textAlign = "left";
        if (!plan) {
            DrawText("BCX was not detected - the migration tool needs BCX running alongside BC+.", 150, 300, "Gray");
            return;
        }
        if (plan.rules.length === 0 && plan.curses.length === 0) {
            DrawText("Nothing to migrate: no rules or curses are configured in BCX.", 150, 300, "Gray");
            return;
        }
        const canEdit = (rules?.canEdit() ?? false) && (curses?.canEdit() ?? true);

        DrawText(`${screen.selected.size} selected`, 150, 205, "Gray");
        MainCanvas.textAlign = "center";
        this.addClickHandler(ButtonActionWidget(
            { Left: 620, Top: 165, Width: 250, Height: 60 },
            { Name: "Select all", HoverText: "Tick every rule and curse that can be migrated" },
            () => {
                for (const item of [...plan.rules, ...plan.curses]) {
                    if (!("locked" in item) || !item.locked) {
                        screen.selected.add(screen.key(item));
                    }
                }
                screen.reopen();
            },
        ));
        this.addClickHandler(ButtonActionWidget(
            { Left: 890, Top: 165, Width: 250, Height: 60 },
            { Name: "Select none", HoverText: "Untick everything" },
            () => {
                screen.selected.clear();
                screen.reopen();
            },
        ));
        this.addClickHandler(ButtonActionWidget(
            { Left: 1160, Top: 165, Width: 250, Height: 60 },
            {
                Name: "Migrate",
                Active: canEdit && screen.selected.size > 0,
                HoverText: canEdit
                    ? "Apply every ticked item to your BC+ configuration"
                    : "Requires permission to edit your own rules and curses",
            },
            () => this.migrate(),
        ));
        MainCanvas.textAlign = "left";

        this.rows.forEach((row, i) => {
            const y = 260 + i * 90;
            if ("header" in row) {
                DrawText(row.header, 158, y + 35, "Gray");
                return;
            }
            if ("unmapped" in row) {
                DrawText(`${row.unmapped.name}`, 230, y + 35, "Gray");
                return;
            }
            const item = row.item;
            const key = screen.key(item);
            const checked = screen.selected.has(key);
            const selectable = item.kind !== "rule" || !item.locked;
            DrawCheckbox(150, y, 64, 64, "", checked, !selectable || !canEdit);
            DrawText(item.kind === "rule" ? item.name : item.label, 240, y + 25, "Black");
            DrawText(this.detail(item), 240, y + 62, item.kind === "rule" && item.locked ? "#A00000" : "Gray");
            this.addClickHandler(() => {
                if (selectable && canEdit && MouseIn(150, y, 64, 64)) {
                    if (checked) {
                        screen.selected.delete(key);
                    } else {
                        screen.selected.add(key);
                    }
                }
            });
        });
    }

    private detail(item: RuleMigrationItem | CurseMigrationItem): string {
        if (item.kind === "curse") {
            const parts = [item.slot.active ? "active" : "switched off"];
            if (item.slot.items[0]?.strict) {
                parts.push("exact state kept");
            }
            if (item.alreadyCursed) {
                parts.push("replaces the existing BC+ curse on this slot");
            }
            return parts.join(" · ");
        }
        if (item.locked) {
            return "locked in BC+ (weld/contract/punishment) - cannot migrate";
        }
        const parts = [item.bcxActive ? "on" : "added but switched off"];
        parts.push(item.enforce ? "enforced" : "not enforced");
        if (item.conditions) {
            parts.push(describeConditions(item.conditions));
        }
        if (item.settings) {
            parts.push("settings translated");
        } else if (item.review) {
            parts.push("review settings after migrating");
        }
        if (item.alreadyActive) {
            parts.push("already active in BC+ (would overwrite)");
        }
        return parts.join(" · ");
    }

    private migrate(): void {
        const screen = this.screen;
        const plan = screen.plan!;
        const rules = this.Core.ModuleManager.getModule<Rules>("rules");
        const curses = this.Core.ModuleManager.getModule<Curses>("curses");
        if (!rules) {
            return;
        }
        const selectedRules = plan.rules.filter((item) => screen.selected.has(screen.key(item)));
        const selectedCurses = plan.curses.filter((item) => screen.selected.has(screen.key(item)));
        void modalConfirm(
            `Migrate ${selectedRules.length} rule${selectedRules.length === 1 ? "" : "s"} and `
            + `${selectedCurses.length} curse${selectedCurses.length === 1 ? "" : "s"} from BCX into BC+?`
            + "\nBCX itself is not changed.",
        ).then((confirmed) => {
            if (!confirmed) {
                return;
            }
            const result = applyMigration(rules, curses, selectedRules, selectedCurses);
            const lines = [`Migrated ${result.rulesApplied} rule${result.rulesApplied === 1 ? "" : "s"} `
                + `and ${result.cursesApplied} curse${result.cursesApplied === 1 ? "" : "s"}.`];
            if (result.reviewNames.length > 0) {
                lines.push(`Review the settings of: ${result.reviewNames.join(", ")}.`);
            }
            if (result.skippedNames.length > 0) {
                lines.push(`Skipped (locked): ${result.skippedNames.join(", ")}.`);
            }
            lines.push("While BCX still enforces a rule, the BC+ twin defers to it - switch the BCX "
                + "rule off whenever ready and BC+ takes over.");
            void modalInfo(lines.join("\n"));
            screen.reopen();
        });
    }
}
