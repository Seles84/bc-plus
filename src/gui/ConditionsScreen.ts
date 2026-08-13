import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { ButtonActionWidget } from "@/system/gui/Widgets";
import { ConditionData, formatDuration } from "@/system/conditions/Conditions";
import { Role, RoleNames } from "@/system/Roles";
import { ElementSetVisible, jsonClone } from "@/utils/BCUtils";
import type { ModuleInstance } from "@/system/module/ModuleInstance";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";

/** What the conditions editor operates on (a rule's or a curse's conditions). */
export interface ConditionTarget {
    label: string;
    /** Wording for the timer's end effect ("Deactivate" for rules, "Lift curse" for curses) */
    removeLabel: string;
    /** Hides the timer section (the global conditions set never has a timer). */
    hideTimer?: boolean;
    get(): ConditionData;
    set(conditions: ConditionData): void;
    canEdit(): boolean;
}

/** Shared editor for rule/curse conditions. */
export class ConditionsScreen extends GUIScreen {

    constructor(
        module: ModuleInstance,
        character: BCPlusCharacter | null,
        readonly target: ConditionTarget,
    ) {
        super(module, character);
    }

    get Title(): string {
        return `Conditions - ${this.target.label}`;
    }

    protected buildPages(): GUIPage[] {
        return [new ConditionsPage(this)];
    }
}

const MEMBERS_INPUT = "BCP_condMembers";
const ROOMS_INPUT = "BCP_condRooms";

class ConditionsPage extends GUIPage {

    constructor(protected override readonly screen: ConditionsScreen) {
        super(screen);
    }

    get Config(): PageOptions {
        return {
            title: this.screen.Title,
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: "Conditions restrict when this is in effect: all configured requirements must "
                + "hold at the same time. The timer additionally ends it when it runs out. "
                + "Requirements that need a room never hold outside chat rooms.",
        };
    }

    private get target(): ConditionTarget {
        return this.screen.target;
    }

    /** Mutates a copy and persists it (works for local and remote targets). */
    private update(mutate: (c: ConditionData) => void): void {
        const conditions = jsonClone(this.target.get());
        mutate(conditions);
        this.target.set(conditions);
    }

    private renderTimer(conditions: ConditionData, canEdit: boolean, LABEL_X: number, CONTROL_X: number): void {
        DrawText("Timer:", LABEL_X, 232, "Black");
        MainCanvas.textAlign = "center";
        this.addClickHandler(ButtonActionWidget(
            { Left: CONTROL_X, Top: 200, Width: 90, Height: 64 },
            { Name: "Off", Active: canEdit, HoverText: "Remove the timer" },
            () => this.update((c) => { delete c.timerEnd; delete c.timerAction; }),
        ));
        const MINUTE = 60_000;
        const HOUR = 60 * MINUTE;
        const DAY = 24 * HOUR;
        const adjustments: { label: string; ms: number }[] = [
            { label: "-1d", ms: -DAY },
            { label: "-1h", ms: -HOUR },
            { label: "-15m", ms: -15 * MINUTE },
            { label: "-5m", ms: -5 * MINUTE },
            { label: "-1m", ms: -MINUTE },
            { label: "+1m", ms: MINUTE },
            { label: "+5m", ms: 5 * MINUTE },
            { label: "+15m", ms: 15 * MINUTE },
            { label: "+1h", ms: HOUR },
            { label: "+1d", ms: DAY },
        ];
        adjustments.forEach((adjustment, i) => {
            this.addClickHandler(ButtonActionWidget(
                { Left: CONTROL_X + 100 + i * 100, Top: 200, Width: 90, Height: 64 },
                { Name: adjustment.label, Active: canEdit, HoverText: `Adjust the timer by ${adjustment.label}` },
                () => this.update((c) => {
                    const now = Date.now();
                    const base = typeof c.timerEnd === "number" && c.timerEnd > now ? c.timerEnd : now;
                    const next = base + adjustment.ms;
                    if (next <= now) {
                        delete c.timerEnd;
                        delete c.timerAction;
                    } else {
                        c.timerEnd = next;
                        c.timerAction ??= "deactivate";
                    }
                }),
            ));
        });
        MainCanvas.textAlign = "left";

        if (typeof conditions.timerEnd === "number") {
            const action = conditions.timerAction === "remove" ? this.target.removeLabel : "Deactivate";
            DrawText("When it ends:", LABEL_X, 312, "Black");
            MainCanvas.textAlign = "center";
            DrawBackNextButton(CONTROL_X, 280, 350, 64, action, canEdit ? "White" : "#ddd", "", () => "", () => "", !canEdit);
            MainCanvas.textAlign = "left";
            // Remaining time lives on this row - after the buttons it would
            // run under the help icon
            DrawText(`Ends in ${formatDuration(Math.max(0, conditions.timerEnd - Date.now()))}`, CONTROL_X + 390, 312, "Gray");
            this.addClickHandler(() => {
                if (canEdit && MouseIn(CONTROL_X, 280, 350, 64)) {
                    this.update((c) => { c.timerAction = c.timerAction === "remove" ? "deactivate" : "remove"; });
                }
            });
        }
    }

    override async create(): Promise<void> {
        const conditions = this.target.get();
        const members = ElementCreateInput(MEMBERS_INPUT, "text", conditions.members ?? "", "300");
        members.addEventListener("change", () => this.update((c) => { c.members = members.value; }));
        const rooms = ElementCreateInput(ROOMS_INPUT, "text", conditions.roomNames ?? "", "300");
        rooms.addEventListener("change", () => this.update((c) => { c.roomNames = rooms.value; }));
    }

    override async destroy(): Promise<void> {
        ElementRemove(MEMBERS_INPUT);
        ElementRemove(ROOMS_INPUT);
    }

    render(): void {
        const conditions = this.target.get();
        const canEdit = this.target.canEdit();

        // The text inputs are DOM elements and would float above the help box
        const inputsVisible = !this.screen.HelpVisible;
        ElementSetVisible(MEMBERS_INPUT, inputsVisible);
        ElementSetVisible(ROOMS_INPUT, inputsVisible);

        // Layout grid: labels at LABEL_X, controls from CONTROL_X, mode buttons in one right column
        const LABEL_X = 150;
        const CONTROL_X = 480;
        const MODE_X = 1290;
        const MODE_W = 300;

        // --- Timer: relative adjustments on the current end time ---
        if (!this.target.hideTimer) {
            this.renderTimer(conditions, canEdit, LABEL_X, CONTROL_X);
        }

        // --- Room type ---
        const roomTypeLabel = conditions.roomType === undefined ? "Any room" : (conditions.roomType === "public" ? "Public rooms only" : "Private rooms only");
        DrawText("Room:", LABEL_X, 412, "Black");
        MainCanvas.textAlign = "center";
        DrawBackNextButton(CONTROL_X, 380, 350, 64, roomTypeLabel, canEdit ? "White" : "#ddd", "", () => "", () => "", !canEdit);
        MainCanvas.textAlign = "left";
        this.addClickHandler(() => {
            if (canEdit && MouseIn(CONTROL_X, 380, 350, 64)) {
                this.update((c) => {
                    c.roomType = c.roomType === undefined ? "public" : (c.roomType === "public" ? "private" : undefined);
                });
            }
        });

        // --- Role presence ---
        const roleModeLabel = conditions.roleMode === undefined ? "Ignored" : (conditions.roleMode === "present" ? "Present" : "Absent");
        DrawText("Role:", LABEL_X, 512, "Black");
        MainCanvas.textAlign = "center";
        DrawBackNextButton(CONTROL_X, 480, 350, 64, `${RoleNames[conditions.role ?? Role.Owner]}+`, canEdit ? "White" : "#ddd", "", () => "", () => "", !canEdit);
        DrawBackNextButton(MODE_X, 480, MODE_W, 64, roleModeLabel, canEdit ? "White" : "#ddd", "", () => "", () => "", !canEdit);
        MainCanvas.textAlign = "left";
        this.addClickHandler(() => {
            if (!canEdit) {
                return;
            }
            if (MouseIn(CONTROL_X, 480, 350, 64)) {
                this.update((c) => {
                    const direction = MouseX < CONTROL_X + 175 ? -1 : 1;
                    const current = c.role ?? Role.Owner;
                    c.role = ((current + direction + RoleNames.length) % RoleNames.length) as Role;
                });
            }
            if (MouseIn(MODE_X, 480, MODE_W, 64)) {
                this.update((c) => {
                    if (c.roleMode === undefined) {
                        c.roleMode = "present";
                        c.role ??= Role.Owner;
                    } else if (c.roleMode === "present") {
                        c.roleMode = "absent";
                    } else {
                        delete c.roleMode;
                    }
                });
            }
        });

        // --- Member presence ---
        const membersModeLabel = conditions.membersMode === undefined ? "Ignored" : (conditions.membersMode === "present" ? "Present" : "Absent");
        DrawText("Members:", LABEL_X, 612, "Black");
        ElementPosition(MEMBERS_INPUT, CONTROL_X + 380, 607, 760, 60);
        const membersInput = document.getElementById(MEMBERS_INPUT) as HTMLInputElement | null;
        if (membersInput) {
            membersInput.disabled = !canEdit;
        }
        MainCanvas.textAlign = "center";
        DrawBackNextButton(MODE_X, 580, MODE_W, 64, membersModeLabel, canEdit ? "White" : "#ddd", "", () => "", () => "", !canEdit);
        MainCanvas.textAlign = "left";
        this.addClickHandler(() => {
            if (canEdit && MouseIn(MODE_X, 580, MODE_W, 64)) {
                this.update((c) => {
                    if (c.membersMode === undefined) {
                        c.membersMode = "present";
                    } else if (c.membersMode === "present") {
                        c.membersMode = "absent";
                    } else {
                        delete c.membersMode;
                    }
                });
            }
        });

        // --- Room names ---
        const roomsModeLabel = conditions.roomNamesMode === undefined ? "Ignored" : (conditions.roomNamesMode === "in" ? "In these rooms" : "Not in these");
        DrawText("Room names:", LABEL_X, 712, "Black");
        ElementPosition(ROOMS_INPUT, CONTROL_X + 380, 707, 760, 60);
        const roomsInput = document.getElementById(ROOMS_INPUT) as HTMLInputElement | null;
        if (roomsInput) {
            roomsInput.disabled = !canEdit;
        }
        MainCanvas.textAlign = "center";
        DrawBackNextButton(MODE_X, 680, MODE_W, 64, roomsModeLabel, canEdit ? "White" : "#ddd", "", () => "", () => "", !canEdit);
        MainCanvas.textAlign = "left";
        this.addClickHandler(() => {
            if (canEdit && MouseIn(MODE_X, 680, MODE_W, 64)) {
                this.update((c) => {
                    if (c.roomNamesMode === undefined) {
                        c.roomNamesMode = "in";
                    } else if (c.roomNamesMode === "in") {
                        c.roomNamesMode = "notin";
                    } else {
                        delete c.roomNamesMode;
                    }
                });
            }
        });

        if (canEdit) {
            MainCanvas.textAlign = "center";
            this.addClickHandler(ButtonActionWidget(
                { Left: 150, Top: 830, Width: 300, Height: 70 },
                { Name: "Clear all", HoverText: "Remove every condition" },
                () => this.target.set({}),
            ));
            MainCanvas.textAlign = "left";
        }
    }
}
