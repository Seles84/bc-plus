/** Shows a beep-style info notification in the top-left corner of the club. */
export function InfoBeep(message: string, duration: number = 4000): void {
    ServerShowBeep(message, duration, { silent: true });
}

/**
 * Shows or hides a DOM input created via ElementCreateInput. DOM elements
 * always float above the canvas, so canvas overlays (help boxes, modals)
 * cannot cover them - they must be hidden explicitly.
 */
export function ElementSetVisible(id: string, visible: boolean): void {
    const element = document.getElementById(id);
    if (element) {
        element.style.display = visible ? "" : "none";
    }
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
