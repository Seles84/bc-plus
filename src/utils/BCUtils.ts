/** Shows a beep-style info notification in the top-left corner of the club. */
export function InfoBeep(message: string, duration: number = 4000): void {
    ServerShowBeep(message, duration, { silent: true });
}

/**
 * Deep-clones JSON-safe data. Unlike structuredClone this works on the
 * storage auto-sync Proxy objects (structuredClone throws DataCloneError
 * on proxies); BC+ save data is JSON-safe by construction.
 */
export function jsonClone<T>(value: T): T {
    if (value === undefined || value === null) {
        return value;
    }
    return JSON.parse(JSON.stringify(value)) as T;
}
