import { Role, RoleNames, roleName } from "@/system/Roles";
import { parseWordList } from "@/rules/speechUtils";
import type Roles from "@/modules/Roles";

/**
 * Conditions restrict when a rule or curse is in effect. All configured
 * requirements must hold simultaneously; the timer additionally ends the
 * rule/curse when it runs out.
 */
export interface ConditionData {
    /** Unix ms when the effect ends; absent = no timer */
    timerEnd?: number;
    /** What happens when the timer ends (default "deactivate") */
    timerAction?: "deactivate" | "remove";
    /** Room privacy requirement; absent = any room */
    roomType?: "public" | "private";
    /** Comma-separated room-name fragments (case-insensitive substring match) */
    roomNames?: string;
    roomNamesMode?: "in" | "notin";
    /** Role requirement: someone of this role or higher... */
    role?: Role;
    /** ...must be present/absent in the room */
    roleMode?: "present" | "absent";
    /** Comma-separated member numbers... */
    members?: string;
    /** ...one of whom must be present/absent */
    membersMode?: "present" | "absent";
}

/** Member numbers from the comma-string form conditions use. */
export function parseMembers(raw: string | undefined): number[] {
    return (raw ?? "")
        .split(",")
        .map((m) => Number.parseInt(m.trim(), 10))
        .filter((m) => Number.isInteger(m) && m >= 0);
}

/** Whether the timer (if any) has run out. */
export function conditionsExpired(c: ConditionData | undefined): boolean {
    return typeof c?.timerEnd === "number" && Date.now() > c.timerEnd;
}

/** Whether all requirements currently hold (timer expiry counts as not met). */
export function conditionsMet(c: ConditionData | undefined, roles: Roles | undefined): boolean {
    if (!c) {
        return true;
    }
    if (conditionsExpired(c)) {
        return false;
    }

    const needsRoom = c.roomType !== undefined || c.roomNamesMode !== undefined
        || c.roleMode !== undefined || c.membersMode !== undefined;
    if (!needsRoom) {
        return true;
    }
    // Room-dependent requirements cannot hold outside a chat room
    if (!ServerPlayerIsInChatRoom() || ChatRoomData == null) {
        return false;
    }

    if (c.roomType !== undefined) {
        const isPrivate = ChatRoomDataIsPrivate(ChatRoomData);
        if ((c.roomType === "private") !== isPrivate) {
            return false;
        }
    }

    if (c.roomNamesMode !== undefined) {
        const fragments = parseWordList(c.roomNames ?? "");
        const roomName = (ChatRoomData.Name ?? "").toLocaleLowerCase();
        const matches = fragments.some((f) => roomName.includes(f));
        if (fragments.length > 0 && matches !== (c.roomNamesMode === "in")) {
            return false;
        }
    }

    if (c.roleMode !== undefined && c.role !== undefined && roles) {
        const present = ChatRoomCharacter.some((character) =>
            typeof character.MemberNumber === "number"
            && character.MemberNumber !== Player.MemberNumber
            && roles.highestRole(character.MemberNumber) <= c.role!,
        );
        if (present !== (c.roleMode === "present")) {
            return false;
        }
    }

    if (c.membersMode !== undefined) {
        const members = parseMembers(c.members);
        const present = members.some((m) => ChatRoomCharacter.some((character) => character.MemberNumber === m));
        if (members.length > 0 && present !== (c.membersMode === "present")) {
            return false;
        }
    }

    return true;
}

/** Validates an untrusted conditions object (remote commands, imports). */
export function sanitizeConditions(raw: unknown): ConditionData | null {
    if (raw === null) {
        return null;
    }
    if (typeof raw !== "object") {
        return null;
    }
    const c = raw as Partial<ConditionData>;
    const result: ConditionData = {};
    if (typeof c.timerEnd === "number" && c.timerEnd > 0 && c.timerEnd < Date.now() + 366 * 24 * 60 * 60_000) {
        result.timerEnd = c.timerEnd;
        result.timerAction = c.timerAction === "remove" ? "remove" : "deactivate";
    }
    if (c.roomType === "public" || c.roomType === "private") {
        result.roomType = c.roomType;
    }
    if ((c.roomNamesMode === "in" || c.roomNamesMode === "notin") && typeof c.roomNames === "string") {
        result.roomNamesMode = c.roomNamesMode;
        result.roomNames = c.roomNames.slice(0, 300);
    }
    if ((c.roleMode === "present" || c.roleMode === "absent")
        && typeof c.role === "number" && c.role >= 0 && c.role < RoleNames.length) {
        result.roleMode = c.roleMode;
        result.role = c.role as Role;
    }
    if ((c.membersMode === "present" || c.membersMode === "absent") && typeof c.members === "string") {
        result.membersMode = c.membersMode;
        result.members = c.members.slice(0, 300);
    }
    return result;
}

/** Short human summary, e.g. "Public rooms · While Owner absent · Expires in 2h". */
export function describeConditions(c: ConditionData | undefined): string {
    if (!c) {
        return "Always in effect";
    }
    const parts: string[] = [];
    if (c.roomType !== undefined) {
        parts.push(c.roomType === "public" ? "Public rooms" : "Private rooms");
    }
    if (c.roomNamesMode !== undefined && (c.roomNames ?? "").trim().length > 0) {
        parts.push(c.roomNamesMode === "in" ? "In named rooms" : "Outside named rooms");
    }
    if (c.roleMode !== undefined && c.role !== undefined) {
        parts.push(`While ${roleName(c.role)}+ ${c.roleMode}`);
    }
    if (c.membersMode !== undefined && (c.members ?? "").trim().length > 0) {
        parts.push(`While listed members ${c.membersMode}`);
    }
    if (typeof c.timerEnd === "number") {
        const remaining = c.timerEnd - Date.now();
        parts.push(remaining <= 0 ? "Expired" : `Expires in ${formatDuration(remaining)}`);
    }
    return parts.length > 0 ? parts.join(" · ") : "Always in effect";
}

export function formatDuration(ms: number): string {
    const minutes = Math.ceil(ms / 60_000);
    if (minutes < 60) {
        return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
}
