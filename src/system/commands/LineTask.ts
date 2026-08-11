/** A "write lines" assignment: the player must type the sentence in chat. */
export interface LineTask {
    sentence: string;
    remaining: number;
    total: number;
    assigner: string;
}

interface LineTaskStore {
    get(): LineTask | null;
    set(task: LineTask | null): void;
}

let store: LineTaskStore | null = null;

/**
 * @internal Wired by the Commands module so the task lives in its save data
 * (surviving reloads) while the static command definitions stay stateless.
 */
export function BindLineTaskStore(taskStore: LineTaskStore | null): void {
    store = taskStore;
}

export function GetLineTask(): LineTask | null {
    const task = store?.get() ?? null;
    // Shape-check - the save is data, not trusted structure
    if (task
        && typeof task.sentence === "string" && task.sentence.length > 0
        && typeof task.remaining === "number" && task.remaining > 0
        && typeof task.total === "number"
        && typeof task.assigner === "string") {
        return task;
    }
    return null;
}

export function SetLineTask(task: LineTask | null): void {
    store?.set(task);
}

/** Normalizes chat text for line matching: case, spacing and OOC parentheses. */
export function NormalizeLineText(text: string): string {
    let normalized = text.trim().toLocaleLowerCase();
    if (normalized.startsWith("(")) {
        normalized = normalized.replace(/^\(+/, "").replace(/\)+$/, "").trim();
    }
    return normalized.replace(/\s+/g, " ");
}
