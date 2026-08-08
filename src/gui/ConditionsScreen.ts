import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { ButtonActionWidget } from "@/system/gui/Widgets";
import { ConditionData, TIMER_PRESETS, formatDuration } from "@/system/conditions/Conditions";
import { Role, RoleNames } from "@/system/Roles";
import { jsonClone } from "@/utils/BCUtils";
import type { ModuleInstance } from "@/system/module/ModuleInstance";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";

/** What the conditions editor operates on (a rule's or a curse's conditions). */
export interface ConditionTarget {
    label: string;
    /** Wording for the timer's end effect ("Deactivate" for rules, "Lift curse" for curses) */
    removeLabel: string;
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

        // --- Timer ---
        DrawText("Timer:", 150, 232, "Black");
        MainCanvas.textAlign = "center";
        this.addClickHandler(ButtonActionWidget(
            { Left: 320, Top: 200, Width: 120, Height: 64 },
            { Name: "Off", Active: canEdit, HoverText: "No timer" },
            () => this.update((c) => { delete c.timerEnd; delete c.timerAction; }),
        ));
        TIMER_PRESETS.forEach((preset, i) => {
            this.addClickHandler(ButtonActionWidget(
                { Left: 460 + i * 140, Top: 200, Width: 120, Height: 64 },
                { Name: preset.label, Active: canEdit, HoverText: `End in ${preset.label}` },
                () => this.update((c) => {
                    c.timerEnd = Date.now() + preset.ms;
                    c.timerAction ??= "deactivate";
                }),
            ));
        });
        MainCanvas.textAlign = "left";
        DrawText(
            typeof conditions.timerEnd === "number"
                ? `Ends in ${formatDuration(Math.max(0, conditions.timerEnd - Date.now()))}`
                : "No timer",
            1080, 232, "Gray",
        );

        if (typeof conditions.timerEnd === "number") {
            const action = conditions.timerAction === "remove" ? this.target.removeLabel : "Deactivate";
            DrawText("When it ends:", 150, 312, "Black");
            MainCanvas.textAlign = "center";
            DrawBackNextButton(460, 280, 350, 64, action, canEdit ? "White" : "#ddd", "", () => "", () => "", !canEdit);
            MainCanvas.textAlign = "left";
            this.addClickHandler(() => {
                if (canEdit && MouseIn(460, 280, 350, 64)) {
                    this.update((c) => { c.timerAction = c.timerAction === "remove" ? "deactivate" : "remove"; });
                }
            });
        }

        // --- Room type ---
        const roomTypeLabel = conditions.roomType === undefined ? "Any room" : (conditions.roomType === "public" ? "Public rooms only" : "Private rooms only");
        DrawText("Room:", 150, 412, "Black");
        MainCanvas.textAlign = "center";
        DrawBackNextButton(460, 380, 350, 64, roomTypeLabel, canEdit ? "White" : "#ddd", "", () => "", () => "", !canEdit);
        MainCanvas.textAlign = "left";
        this.addClickHandler(() => {
            if (canEdit && MouseIn(460, 380, 350, 64)) {
                this.update((c) => {
                    c.roomType = c.roomType === undefined ? "public" : (c.roomType === "public" ? "private" : undefined);
                });
            }
        });

        // --- Role presence ---
        const roleModeLabel = conditions.roleMode === undefined ? "Ignored" : (conditions.roleMode === "present" ? "Present" : "Absent");
        DrawText("Role:", 150, 512, "Black");
        MainCanvas.textAlign = "center";
        DrawBackNextButton(460, 480, 350, 64, `${RoleNames[conditions.role ?? Role.Owner]}+`, canEdit ? "White" : "#ddd", "", () => "", () => "", !canEdit);
        DrawBackNextButton(850, 480, 300, 64, roleModeLabel, canEdit ? "White" : "#ddd", "", () => "", () => "", !canEdit);
        MainCanvas.textAlign = "left";
        this.addClickHandler(() => {
            if (!canEdit) {
                return;
            }
            if (MouseIn(460, 480, 350, 64)) {
                this.update((c) => {
                    const direction = MouseX < 460 + 175 ? -1 : 1;
                    const current = c.role ?? Role.Owner;
                    c.role = ((current + direction + RoleNames.length) % RoleNames.length) as Role;
                });
            }
            if (MouseIn(850, 480, 300, 64)) {
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
        DrawText("Members:", 150, 612, "Black");
        ElementPosition(MEMBERS_INPUT, 610, 607, 640, 60);
        const membersInput = document.getElementById(MEMBERS_INPUT) as HTMLInputElement | null;
        if (membersInput) {
            membersInput.disabled = !canEdit;
        }
        MainCanvas.textAlign = "center";
        DrawBackNextButton(990, 580, 300, 64, membersModeLabel, canEdit ? "White" : "#ddd", "", () => "", () => "", !canEdit);
        MainCanvas.textAlign = "left";
        this.addClickHandler(() => {
            if (canEdit && MouseIn(990, 580, 300, 64)) {
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
        DrawText("Room names:", 150, 712, "Black");
        ElementPosition(ROOMS_INPUT, 610, 707, 640, 60);
        const roomsInput = document.getElementById(ROOMS_INPUT) as HTMLInputElement | null;
        if (roomsInput) {
            roomsInput.disabled = !canEdit;
        }
        MainCanvas.textAlign = "center";
        DrawBackNextButton(990, 680, 300, 64, roomsModeLabel, canEdit ? "White" : "#ddd", "", () => "", () => "", !canEdit);
        MainCanvas.textAlign = "left";
        this.addClickHandler(() => {
            if (canEdit && MouseIn(990, 680, 300, 64)) {
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
