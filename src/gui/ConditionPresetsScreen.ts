import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { ButtonActionWidget } from "@/system/gui/Widgets";
import { describeConditions } from "@/system/conditions/Conditions";
import {
    ConditionPreset,
    MAX_CONDITION_PRESETS,
    PRESET_NAME_MAX,
    applyConditionPreset,
    deleteConditionPreset,
    getConditionPresets,
    saveConditionPreset,
} from "@/system/conditions/Presets";
import { modalConfirm, modalPrompt } from "@/gui/Modal";
import type { ConditionTarget } from "@/gui/ConditionsScreen";
import type { GUI } from "@/modules/GUI";
import type { ModuleInstance } from "@/system/module/ModuleInstance";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";

const PER_PAGE = 6;

/**
 * The player's personal condition-preset library, opened from the conditions
 * editor. Saving and deleting is always allowed (it is the viewer's own
 * library); applying requires edit permission on the underlying target.
 */
export class ConditionPresetsScreen extends GUIScreen {

    constructor(
        module: ModuleInstance,
        character: BCPlusCharacter | null,
        readonly target: ConditionTarget,
    ) {
        super(module, character);
    }

    get Title(): string {
        return `Condition presets - ${this.target.label}`;
    }

    /** Core module data holds the preset library (private, never synced). */
    get PresetStore(): ModuleInstance | undefined {
        return this.Module.ModuleManager.getModule("core");
    }

    protected buildPages(): GUIPage[] {
        const store = this.PresetStore;
        const presets = store ? getConditionPresets(store) : [];
        const pages: GUIPage[] = [];
        for (let i = 0; i < Math.max(1, Math.ceil(presets.length / PER_PAGE)); i++) {
            pages.push(new ConditionPresetsPage(this, presets.slice(i * PER_PAGE, (i + 1) * PER_PAGE)));
        }
        return pages;
    }
}

class ConditionPresetsPage extends GUIPage {

    constructor(
        protected override readonly screen: ConditionPresetsScreen,
        private readonly rows: ConditionPreset[],
    ) {
        super(screen);
    }

    get Config(): PageOptions {
        return {
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: "Presets are your personal library of reusable condition sets (e.g. \"Quiet "
                + "hours\" as a nightly time window). Save the conditions currently configured on "
                + "this editor under a name, then apply any preset here or on any other rule, "
                + "global conditions, curse or punishment. Applying replaces the configured "
                + "conditions but keeps a running timer; presets never store timers.",
        };
    }

    private get target(): ConditionTarget {
        return this.screen.target;
    }

    render(): void {
        const store = this.screen.PresetStore;
        if (!store) {
            DrawText("Preset storage unavailable.", 150, 250, "Gray");
            return;
        }
        const total = getConditionPresets(store).length;
        const canApply = this.target.canEdit();

        MainCanvas.textAlign = "left";
        DrawText(`${total}/${MAX_CONDITION_PRESETS} presets`, 1500, 200, "Gray");

        MainCanvas.textAlign = "center";
        this.addClickHandler(ButtonActionWidget(
            { Left: 150, Top: 170, Width: 520, Height: 64 },
            {
                Name: "Save current as preset...",
                Active: total < MAX_CONDITION_PRESETS,
                HoverText: total < MAX_CONDITION_PRESETS
                    ? "Store this editor's current conditions under a name (same name overwrites)"
                    : "Preset library is full - delete one first",
            },
            () => {
                void modalPrompt("Preset name:", "", PRESET_NAME_MAX).then((name) => {
                    if (name !== null && saveConditionPreset(store, name, this.target.get())) {
                        this.screen.reopen();
                    }
                });
            },
        ));
        MainCanvas.textAlign = "left";

        if (this.rows.length === 0) {
            DrawText("No presets yet - configure conditions, then save them here under a name.", 150, 320, "Gray");
        }

        this.rows.forEach((preset, i) => {
            const y = 280 + i * 100;
            DrawText(preset.name, 150, y + 25, "Black");
            DrawText(describeConditions(preset.conditions), 150, y + 65, "Gray");
            MainCanvas.textAlign = "center";
            this.addClickHandler(ButtonActionWidget(
                { Left: 1280, Top: y, Width: 260, Height: 64 },
                {
                    Name: "Apply",
                    Active: canApply,
                    HoverText: canApply
                        ? `Replace the configured conditions with "${preset.name}"`
                        : "No permission to edit these conditions",
                },
                () => {
                    this.target.set(applyConditionPreset(this.target.get(), preset));
                    // Back to the editor so the applied result is visible
                    this.Core.ModuleManager.getModule<GUI>("gui")?.backSubscreen();
                },
            ));
            this.addClickHandler(ButtonActionWidget(
                { Left: 1560, Top: y, Width: 120, Height: 64 },
                { Name: "X", HoverText: `Delete preset "${preset.name}"` },
                () => {
                    void modalConfirm(`Delete preset "${preset.name}"?`, true).then((confirmed) => {
                        if (confirmed) {
                            deleteConditionPreset(store, preset.name);
                            this.screen.reopen();
                        }
                    });
                },
            ));
            MainCanvas.textAlign = "left";
        });
    }
}
