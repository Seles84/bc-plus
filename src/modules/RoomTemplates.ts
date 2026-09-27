import menuIcon from "@/assets/icons/rooms.png";
import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig } from "@/system/module/ModuleTypes";
import { BCPLUS_AUTHOR, BCPLUS_VERSION } from "@/system/Constants";
import { stringListValue } from "@/system/gui/Settings";
import { BCPNotifyPlayer } from "@/utils/Messaging";
import { MovePlayerToRoom, jsonClone } from "@/utils/BCUtils";
import { debug } from "@/system/Console";
import type Rules from "@/modules/Rules";
import type { GUI as GUIModule } from "@/modules/GUI";

/** A saved room setup, applied by rejoining the room or recreating it. */
export interface RoomTemplate {
    /** JSON-safe snapshot of the room settings (ServerChatRoomSettings shape). */
    room: Record<string, unknown> & { Name: string };
    savedAt: number;
}

export const MAX_TEMPLATES = 20;

/** A template (in practice: its map data) may not exceed this serialized size. */
const MAX_TEMPLATE_JSON = 40_000;

/** Room fields worth snapshotting - mirrors what BC sends on ChatRoomCreate. */
const ROOM_FIELDS = [
    "Name", "Description", "Background", "Access", "Visibility", "Space", "Game",
    "Admin", "Whitelist", "Ban", "Limit", "Language", "BlockCategory", "Custom", "MapData",
] as const;

/**
 * The BC+ button on BC's room create/update screen: top-right corner of the
 * background preview image (1300, 75, 600x350). That area is pure canvas -
 * DOM inputs cover canvas buttons everywhere around the form fields, which
 * ruled out the name row. Our click hook runs before BC's, so the click
 * never reaches BC's preview-mode toggle on that same rectangle.
 */
const ADMIN_BUTTON: [number, number, number, number] = [1846, 81, 48, 48];

interface PendingVisit {
    name: string;
    room: Record<string, unknown>;
    stage: "join" | "create";
    /** A RoomAlreadyExist race retries the join exactly once. */
    retried: boolean;
    timer: ReturnType<typeof setTimeout>;
}

/**
 * Saved room templates: capture the room you are in, then return to it later
 * with one action - joining it when it exists, recreating it from the
 * snapshot when it does not (the "navigate between the rooms of my house"
 * workflow). Local-only data; the room rules (entering/creating) still apply,
 * since a template visit is player-initiated - unlike a summon.
 */
export default class RoomTemplates extends ModuleInstance {

    private pendingVisit: PendingVisit | null = null;

    protected readonly SystemConfig: ModuleConfig = {
        Name: "Rooms",
        Version: BCPLUS_VERSION,
        Author: BCPLUS_AUTHOR,
        Description: "Saved room setups: rejoin or recreate your rooms in one click",
        Active: true,
        Icon: menuIcon,
        HoverText: "Save the full setup of rooms you run (name, description, background, "
            + "lists, map...) as templates. Going to a template joins the room when it "
            + "exists and recreates it from the snapshot when it does not.",
        PublicData: false,
        Reference: "rooms",
        MenuString: "Rooms",
    };

    override get CanDisable(): boolean {
        return true;
    }

    override get HasGUI(): boolean {
        return true;
    }

    override get Defaults(): Record<string, unknown> {
        return { templates: [] };
    }

    get Templates(): RoomTemplate[] {
        const raw = this.Data.templates;
        return Array.isArray(raw) ? raw as RoomTemplate[] : [];
    }

    override Load(): void {
        // Join responses only matter while a visit is in flight; BC's own
        // handling (toasts, room entry via ChatRoomSync) runs first.
        this.addHook("ChatSearchResponse", 5, (args, next) => {
            const result = next(args);
            const pending = this.pendingVisit;
            const data = args[0];
            if (pending && pending.stage === "join" && typeof data === "string") {
                if (data === "JoinedRoom") {
                    this.finishVisit(`Joined "${pending.name}".`);
                } else if (data === "CannotFindRoom") {
                    this.createFromPending(pending);
                } else {
                    this.finishVisit(`Could not enter "${pending.name}" (${data}).`);
                }
            }
            return result;
        });

        // Entry point on BC's room create/update screen. Priority 10 stays
        // under BCX's second-page hook (priority 11, which returns without
        // calling next), so this never draws over BCX's template page.
        // Drawn after next(), so it sits on top of the preview image.
        this.addHook("ChatAdminRun", 10, (args, next) => {
            const result = next(args);
            if (this.adminButtonVisible()) {
                DrawButton(...ADMIN_BUTTON, "", "White", null, "BC+ room templates");
                // Icon drawn separately: DrawButton blits images at their
                // natural size (the logo is 96px, the button 48px)
                DrawImageResize(menuIcon, ADMIN_BUTTON[0] + 2, ADMIN_BUTTON[1] + 2, 44, 44);
            }
            return result;
        });

        this.addHook("ChatAdminClick", 10, (args, next) => {
            if (this.adminButtonVisible() && MouseIn(...ADMIN_BUTTON)) {
                this.ModuleManager.getModule<GUIModule>("gui")?.openRoomsScreen();
                return;
            }
            return next(args);
        });

        this.addHook("ChatCreateResponse", 5, (args, next) => {
            const result = next(args);
            const pending = this.pendingVisit;
            const data = args[0];
            if (pending && pending.stage === "create" && typeof data === "string") {
                if (data === "ChatRoomCreated") {
                    this.finishVisit(`Recreated "${pending.name}".`);
                } else if (data === "RoomAlreadyExist" && !pending.retried) {
                    // Someone created it between our join miss and the create
                    pending.retried = true;
                    pending.stage = "join";
                    ChatSearchJoin(pending.name);
                } else {
                    this.finishVisit(`Could not create "${pending.name}" (${data}).`);
                }
            }
            return result;
        });
    }

    override Unload(): void {
        if (this.pendingVisit !== null) {
            clearTimeout(this.pendingVisit.timer);
            this.pendingVisit = null;
        }
        super.Unload();
    }

    /**
     * Snapshots the current room into a new template (or over an existing
     * one). Returns an error message to show, or null on success.
     */
    captureCurrentRoom(replaceIndex?: number): string | null {
        if (!ServerPlayerIsInChatRoom() || !ChatRoomData) {
            return "You are not in a chat room.";
        }
        if (replaceIndex === undefined && this.Templates.length >= MAX_TEMPLATES) {
            return `Template limit reached (${MAX_TEMPLATES}).`;
        }
        const source = ChatRoomData as unknown as Record<string, unknown>;
        const room: Record<string, unknown> = {};
        for (const field of ROOM_FIELDS) {
            if (source[field] !== undefined) {
                room[field] = jsonClone(source[field]);
            }
        }
        if (typeof room.Name !== "string" || room.Name.length === 0) {
            return "This room has no usable name.";
        }
        if (JSON.stringify(room).length > MAX_TEMPLATE_JSON) {
            return "This room's data (usually its map) is too large to store as a template.";
        }
        const template: RoomTemplate = { room: room as RoomTemplate["room"], savedAt: Date.now() };
        if (replaceIndex !== undefined && this.Templates[replaceIndex] !== undefined) {
            this.Templates[replaceIndex] = template;
        } else {
            this.Templates.push(template);
        }
        return null;
    }

    removeTemplate(index: number): void {
        this.Templates.splice(index, 1);
    }

    /** Moves a template up (-1) or down (+1) in the list. */
    moveTemplate(index: number, direction: -1 | 1): void {
        const templates = this.Templates;
        const target = index + direction;
        if (templates[index] === undefined || templates[target] === undefined) {
            return;
        }
        const moved = jsonClone(templates[index]);
        templates[index] = jsonClone(templates[target]);
        templates[target] = moved;
    }

    /** Finds a template by exact room name, then unique prefix (case-insensitive). */
    findTemplate(query: string): { index: number; matches: string[] } {
        const lower = query.toLocaleLowerCase();
        const names = this.Templates.map((t) => t.room.Name);
        const exact = names.findIndex((name) => name.toLocaleLowerCase() === lower);
        if (exact >= 0) {
            return { index: exact, matches: [names[exact]!] };
        }
        const prefixed = names
            .map((name, index) => ({ name, index }))
            .filter((entry) => entry.name.toLocaleLowerCase().startsWith(lower));
        return prefixed.length === 1
            ? { index: prefixed[0]!.index, matches: [prefixed[0]!.name] }
            : { index: -1, matches: prefixed.map((entry) => entry.name) };
    }

    /**
     * Goes to a template's room: join when it exists, recreate otherwise.
     * The outcome arrives via the response hooks; failures are notified.
     */
    async visit(index: number): Promise<void> {
        const template = this.Templates[index];
        if (!template) {
            return;
        }
        const name = template.room.Name;
        if (this.pendingVisit !== null) {
            BCPNotifyPlayer("Already on the way to a room.");
            return;
        }
        if (ServerPlayerIsInChatRoom() && ChatRoomData?.Name === name) {
            BCPNotifyPlayer(`You are already in "${name}".`);
            return;
        }
        const blocked = this.visitBlockReason(name);
        if (blocked !== null) {
            BCPNotifyPlayer(`Cannot go to "${name}" - ${blocked}.`);
            return;
        }
        if (ServerPlayerIsInChatRoom() && !ChatRoomCanLeave()) {
            BCPNotifyPlayer("You cannot leave this room right now.");
            return;
        }
        const pending: PendingVisit = {
            name,
            room: jsonClone(template.room) as Record<string, unknown>,
            stage: "join",
            retried: false,
            timer: setTimeout(() => {
                if (this.pendingVisit === pending) {
                    this.pendingVisit = null;
                    BCPNotifyPlayer(`No server response while heading to "${name}".`);
                }
            }, 20_000),
        };
        this.pendingVisit = pending;
        debug(`Visiting room template "${name}"`);
        const space = typeof pending.room.Space === "string" ? pending.room.Space as ServerChatRoomSpace : undefined;
        await MovePlayerToRoom(name, space);
    }

    /** Whether BC's room create/update screen is open and editable. */
    adminScreenOpen(): boolean {
        return CurrentScreen === "ChatAdmin" && ChatAdminData != null
            && !ChatAdminPreviewBackgroundMode && ChatAdminCanEdit();
    }

    private adminButtonVisible(): boolean {
        return ChatAdminData != null && !ChatAdminPreviewBackgroundMode && ChatAdminCanEdit();
    }

    /**
     * Fills BC's room create/update form from a template - BCX's "apply
     * template" flow. The user still reviews and presses Create/Save
     * themselves, so no rule checks here beyond the screen's own.
     */
    applyToAdminForm(index: number): boolean {
        const template = this.Templates[index];
        if (!template || !this.adminScreenOpen()) {
            return false;
        }
        const room = jsonClone(template.room) as Record<string, unknown>;
        const data = ChatAdminData!;
        const text = (value: unknown): string => (typeof value === "string" ? value : "");
        const list = (value: unknown): string => (Array.isArray(value) ? value.join(",") : "");
        ElementValue("InputName", text(room.Name));
        ElementValue("InputDescription", text(room.Description));
        ElementValue("InputAdminList", list(room.Admin));
        ElementValue("InputWhitelist", list(room.Whitelist));
        ElementValue("InputBanList", list(room.Ban));
        ElementValue("InputSize", typeof room.Limit === "number" ? String(room.Limit) : "10");
        if (typeof room.Background === "string") {
            data.Background = room.Background;
            const backgroundIndex = ChatAdminBackgroundList?.indexOf(room.Background) ?? -1;
            if (backgroundIndex >= 0) {
                ChatAdminBackgroundIndex = backgroundIndex;
            }
        }
        // Mirror BC's own index resolution (ChatAdminLoad): mode buttons
        // display from the index, not from the data
        if (Array.isArray(room.Visibility)) {
            data.Visibility = room.Visibility as ServerChatRoomRole[];
            ChatAdminVisibilityModeIndex = Math.max(0, ChatAdminVisibilityModeValues.findIndex(
                (roles) => [...roles].sort().join(",") === [...data.Visibility].sort().join(",")));
        }
        if (Array.isArray(room.Access)) {
            data.Access = room.Access as ServerChatRoomRole[];
            ChatAdminAccessModeIndex = Math.max(0, ChatAdminAccessModeValues.findIndex(
                (roles) => [...roles].sort().join(",") === [...data.Access].sort().join(",")));
        }
        if (typeof room.Game === "string") {
            data.Game = room.Game as ServerChatRoomGame;
        }
        if (typeof room.Language === "string") {
            data.Language = room.Language as ServerChatRoomLanguage;
        }
        if (Array.isArray(room.BlockCategory)) {
            data.BlockCategory = room.BlockCategory as ServerChatRoomBlockCategory[];
        }
        data.Custom = room.Custom as ServerChatRoomData["Custom"];
        data.MapData = (room.MapData ?? { Type: "Never" }) as ServerChatRoomMapData;
        debug(`Filled the room form from template "${text(room.Name)}"`);
        return true;
    }

    /**
     * Why the player's own rules forbid entering this room, or null. A
     * template visit is player-initiated navigation, so - unlike a
     * permission-gated summon - the room entry rule applies to it.
     */
    visitBlockReason(name: string): string | null {
        const rules = this.ModuleManager.getModule<Rules>("rules");
        if (rules?.Config.Active !== true) {
            return null;
        }
        try {
            const state = rules.peekRuleState("rooms.entry");
            if (state.active && state.enforce && rules.ruleInEffect("rooms.entry")) {
                const allowed = stringListValue(state.settings["allowedRooms"]);
                if (allowed.length > 0 && !allowed.some((entry) => entry.toLocaleLowerCase() === name.toLocaleLowerCase())) {
                    return "a rule does not allow you to enter that room";
                }
            }
        } catch {
            // Rule not in the registry - nothing to enforce
        }
        return null;
    }

    /** Why the player's own rules forbid creating rooms right now, or null. */
    private createBlockReason(): string | null {
        const rules = this.ModuleManager.getModule<Rules>("rules");
        if (rules?.Config.Active !== true) {
            return null;
        }
        try {
            const state = rules.peekRuleState("rooms.create");
            if (state.active && state.enforce && rules.ruleInEffect("rooms.create")) {
                return "a rule forbids you from creating chat rooms";
            }
        } catch {
            // Rule not in the registry - nothing to enforce
        }
        return null;
    }

    private createFromPending(pending: PendingVisit): void {
        const reason = this.createBlockReason();
        if (reason !== null) {
            this.finishVisit(`"${pending.name}" does not exist and ${reason}.`);
            return;
        }
        pending.stage = "create";
        const room = jsonClone(pending.room);
        // The creator administrates the recreated room even when the snapshot
        // was taken in someone else's room
        const admin = Array.isArray(room.Admin) ? room.Admin as number[] : [];
        if (Player.MemberNumber !== undefined && !admin.includes(Player.MemberNumber)) {
            admin.unshift(Player.MemberNumber);
        }
        room.Admin = admin;
        debug(`Recreating room "${pending.name}" from template`);
        ServerSend("ChatRoomCreate", room as ServerChatRoomCreateRequest);
    }

    private finishVisit(message: string): void {
        if (this.pendingVisit !== null) {
            clearTimeout(this.pendingVisit.timer);
            this.pendingVisit = null;
        }
        BCPNotifyPlayer(message);
    }
}
