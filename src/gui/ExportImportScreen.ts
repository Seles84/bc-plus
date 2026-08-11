import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { ButtonActionWidget } from "@/system/gui/Widgets";
import { copyExportCode, decodeExport, encodeExport, promptImportCode } from "@/utils/ExportImport";
import { BCPNotifyPlayer } from "@/utils/Messaging";
import { jsonClone } from "@/utils/BCUtils";
import type Rules from "@/modules/Rules";
import type Curses from "@/modules/Curses";
import type Relationships from "@/modules/Relationships";

/** Central hub for exporting and importing BC+ configuration codes. */
export class ExportImportScreen extends GUIScreen {

    get Title(): string {
        return "Export / Import";
    }

    protected buildPages(): GUIPage[] {
        return [new ExportImportPage(this)];
    }
}

class ExportImportPage extends GUIPage {

    get Config(): PageOptions {
        return {
            title: "Export / Import",
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: "Export copies a shareable BCP1 code to your clipboard; Import applies a pasted "
                + "code. Rules codes carry every rule's state and settings, curses codes carry the "
                + "full loadout (merged by slot), relationships codes carry your custom names "
                + "(merged by member), and Everything combines all three. Importing requires "
                + "the matching edit permission.",
        };
    }

    private get rules(): Rules | undefined {
        return this.Core.ModuleManager.getModule<Rules>("rules");
    }

    private get curses(): Curses | undefined {
        return this.Core.ModuleManager.getModule<Curses>("curses");
    }

    private get relationships(): Relationships | undefined {
        return this.Core.ModuleManager.getModule<Relationships>("relationships");
    }

    render(): void {
        const rules = this.rules;
        const curses = this.curses;
        const relationships = this.relationships;

        this.section(250, "Rules",
            `${rules?.Definitions.length ?? 0} rules`,
            rules !== undefined,
            rules?.canEdit() ?? false,
            () => copyExportCode(rules!.exportCode()),
            (code) => rules!.importCode(code),
            "rule");

        this.section(390, "Curses",
            `${Object.keys(curses?.Slots ?? {}).length} cursed slots`,
            curses !== undefined,
            curses?.canEdit() ?? false,
            () => copyExportCode(curses!.exportCode()),
            (code) => curses!.importCode(code),
            "cursed slot");

        this.section(530, "Relationships",
            `${Object.keys(relationships?.Entries ?? {}).length} custom names`,
            relationships !== undefined,
            relationships?.canEdit() ?? false,
            () => copyExportCode(relationships!.exportCode()),
            (code) => relationships!.importCode(code),
            "custom name");

        this.section(670, "Everything",
            "rules + curses + relationships in one code",
            rules !== undefined && curses !== undefined && relationships !== undefined,
            (rules?.canEdit() ?? false) && (curses?.canEdit() ?? false) && (relationships?.canEdit() ?? false),
            () => copyExportCode(encodeExport("all", {
                rules: jsonClone(rules!.Data.rules),
                curses: jsonClone(curses!.Data.slots),
                relationships: jsonClone(relationships!.Data.entries),
            })),
            (code) => this.importAll(code),
            "item");
    }

    private section(
        y: number,
        label: string,
        info: string,
        canExport: boolean,
        canImport: boolean,
        exportAction: () => void,
        importAction: (code: string) => number,
        unit: string,
    ): void {
        DrawText(label, 150, y + 32, "Black");
        DrawText(info, 150, y + 70, "Gray");
        this.addClickHandler(ButtonActionWidget(
            { Left: 600, Top: y, Width: 220, Height: 64 },
            { Name: "Export", Active: canExport, HoverText: `Copy your ${label.toLocaleLowerCase()} as a shareable code` },
            exportAction,
        ));
        this.addClickHandler(ButtonActionWidget(
            { Left: 850, Top: y, Width: 220, Height: 64 },
            { Name: "Import", Active: canImport, HoverText: canImport ? "Apply a pasted code" : "Requires the matching edit permission" },
            () => {
                void promptImportCode().then((code) => {
                    if (code !== null) {
                        const applied = importAction(code);
                        BCPNotifyPlayer(applied > 0
                            ? `Imported ${applied} ${unit}${applied === 1 ? "" : "s"}.`
                            : "That code could not be read.");
                        this.screen.reopen();
                    }
                });
            },
        ));
    }

    /** Combined codes re-wrap each part and reuse the modules' validated importers. */
    private importAll(code: string): number {
        const payload = decodeExport(code, "all");
        if (typeof payload !== "object" || payload === null) {
            return 0;
        }
        const parts = payload as { rules?: unknown; curses?: unknown; relationships?: unknown };
        let applied = 0;
        if (parts.rules !== undefined && this.rules) {
            applied += this.rules.importCode(encodeExport("rules", parts.rules));
        }
        if (parts.curses !== undefined && this.curses) {
            applied += this.curses.importCode(encodeExport("curses", parts.curses));
        }
        if (parts.relationships !== undefined && this.relationships) {
            applied += this.relationships.importCode(encodeExport("relationships", parts.relationships));
        }
        return applied;
    }
}
