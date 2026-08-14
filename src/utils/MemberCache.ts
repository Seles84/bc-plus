/**
 * Persistent member-name cache: everyone the player encounters (room members,
 * browse-picker selections) is remembered by number, name and nickname, so
 * lists referencing offline members can still show who they are instead of
 * "Unknown". Backed by the Core module's private data slice (never synced to
 * other players); bound once storage is ready.
 */

export interface KnownMember {
    /** Account name */
    name: string;
    /** Nickname when they were last seen (omitted when none/same as name) */
    nick?: string;
    /** When this entry was last refreshed (ms epoch) */
    seen: number;
}

const MAX_ENTRIES = 300;
/** Unchanged entries are re-stamped at most this often, to limit save churn */
const REFRESH_MS = 6 * 60 * 60 * 1000;

let store: Record<string, KnownMember> | null = null;

/** Wires the cache to its persistent backing store (Core data, auto-synced). */
export function bindMemberCache(target: Record<string, KnownMember>): void {
    store = target;
}

/** The cached identity of a member, or null when never seen. */
export function knownMember(member: number): KnownMember | null {
    const entry = store?.[String(member)];
    return entry && typeof entry.name === "string" ? entry : null;
}

/** Records (or refreshes) a member's name and nickname. */
export function rememberMember(member: number, name: string, nick?: string): void {
    if (
        store === null
        || !Number.isInteger(member) || member < 0
        || member === Player.MemberNumber
        || typeof name !== "string" || name.length === 0
        || name.startsWith("#") // "#1234" placeholder rows, not a real name
    ) {
        return;
    }
    const key = String(member);
    const nickValue = typeof nick === "string" && nick.length > 0 && nick !== name ? nick : undefined;
    const entry = store[key];
    const now = Date.now();
    if (entry && entry.name === name && entry.nick === nickValue && now - entry.seen < REFRESH_MS) {
        return;
    }
    store[key] = nickValue !== undefined ? { name, nick: nickValue, seen: now } : { name, seen: now };
    prune();
}

/** Convenience wrapper for BC character objects. */
export function rememberCharacter(character: Character): void {
    if (typeof character.MemberNumber === "number") {
        rememberMember(character.MemberNumber, character.Name, character.Nickname);
    }
}

/** Drops the longest-unseen entries once the cache exceeds its cap. */
function prune(): void {
    if (store === null) {
        return;
    }
    const keys = Object.keys(store);
    if (keys.length <= MAX_ENTRIES) {
        return;
    }
    const byAge = keys.sort((a, b) => (store![a]?.seen ?? 0) - (store![b]?.seen ?? 0));
    for (const key of byAge.slice(0, keys.length - MAX_ENTRIES)) {
        delete store[key];
    }
}
