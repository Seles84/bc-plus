export type LogCategory = "rule" | "curse" | "punishment" | "authority" | "role" | "relationship" | "welding" | "praise" | "scold" | "note" | "other";

export interface LogEntry {
    /** Unix ms timestamp */
    time: number;
    category: LogCategory;
    message: string;
}

/** Maximum entries kept; the oldest are pruned beyond this. */
export const LOG_MAX_ENTRIES = 200;

/** Maximum entries sent in a remote log response. */
export const LOG_REMOTE_LIMIT = 100;

export function formatLogTime(time: number): string {
    const date = new Date(time);
    return date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}
