/**
 * Escape routing for in-window modals: the window shell owns the Escape key
 * (back/close navigation), so an open modal registers here and the shell
 * lets the topmost modal consume the key first.
 */

const handlers: (() => void)[] = [];

/** Registers a modal's close action; returns its unregister. */
export function pushEscapeHandler(handler: () => void): () => void {
    handlers.push(handler);
    return () => {
        const index = handlers.indexOf(handler);
        if (index !== -1) {
            handlers.splice(index, 1);
        }
    };
}

/** Closes the topmost modal; false when no modal is open. */
export function handleModalEscape(): boolean {
    const handler = handlers[handlers.length - 1];
    if (!handler) {
        return false;
    }
    handler();
    return true;
}
