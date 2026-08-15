/**
 * BC+ mini modals: DOM-based (not canvas), so they work anywhere - including
 * during login/storage init before any BC+ screen exists - and on top of any
 * game screen. Promise-based replacements for alert/confirm/prompt.
 * Calls are queued; only one modal shows at a time.
 */

interface ModalOptions {
    text: string;
    /** Button labels; the first is the affirmative (Enter), the last cancels (Escape) */
    buttons: string[];
    input?: { value?: string; maxLength?: number };
    /** Style the affirmative button red for destructive actions */
    danger?: boolean;
}

interface ModalResult {
    button: string;
    value: string;
}

let queue: Promise<unknown> = Promise.resolve();

function buildModal(options: ModalOptions, resolve: (result: ModalResult) => void): void {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.55);"
        + "z-index:100000;display:flex;align-items:center;justify-content:center;";

    const card = document.createElement("div");
    card.style.cssText = "background:#241c2e;color:#e8e2f0;border:1px solid #8469b6;"
        + "border-left:5px solid #8469b6;border-radius:8px;max-width:520px;min-width:340px;"
        + "padding:20px 24px;font-family:system-ui,sans-serif;font-size:17px;line-height:1.5;"
        + "box-shadow:0 8px 40px rgba(0,0,0,0.6);";

    const title = document.createElement("div");
    title.textContent = "BC+";
    title.style.cssText = "color:#b794e6;font-weight:600;margin-bottom:8px;";
    card.appendChild(title);

    const text = document.createElement("div");
    text.textContent = options.text;
    text.style.cssText = "white-space:pre-wrap;margin-bottom:16px;";
    card.appendChild(text);

    let input: HTMLInputElement | null = null;
    if (options.input) {
        input = document.createElement("input");
        input.type = "text";
        input.value = options.input.value ?? "";
        input.maxLength = options.input.maxLength ?? 300;
        input.style.cssText = "width:100%;box-sizing:border-box;background:#1a1520;color:#e8e2f0;"
            + "border:1px solid #8469b6;border-radius:4px;padding:8px 10px;font-size:16px;"
            + "margin-bottom:16px;outline:none;";
        card.appendChild(input);
    }

    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:10px;justify-content:flex-end;";

    const finish = (button: string): void => {
        document.removeEventListener("keydown", onKey, true);
        overlay.remove();
        resolve({ button, value: input?.value ?? "" });
    };

    options.buttons.forEach((label, i) => {
        const btn = document.createElement("button");
        btn.textContent = label;
        const affirmative = i === 0;
        const background = affirmative ? (options.danger ? "#c94f4f" : "#8469b6") : "#3b2e52";
        btn.style.cssText = `background:${background};color:#fff;border:none;border-radius:4px;`
            + "padding:8px 18px;font-size:16px;cursor:pointer;font-family:inherit;";
        btn.addEventListener("click", () => finish(label));
        row.appendChild(btn);
    });
    card.appendChild(row);

    const onKey = (event: KeyboardEvent): void => {
        if (event.key === "Enter") {
            event.stopPropagation();
            finish(options.buttons[0]!);
        } else if (event.key === "Escape") {
            event.stopPropagation();
            finish(options.buttons[options.buttons.length - 1]!);
        }
    };
    document.addEventListener("keydown", onKey, true);

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    (input ?? overlay).focus?.();
    input?.select();
}

function showModal(options: ModalOptions): Promise<ModalResult> {
    const result = queue.then(() => new Promise<ModalResult>((resolve) => buildModal(options, resolve)));
    queue = result.catch(() => undefined);
    return result;
}

/** alert() replacement. */
export function modalInfo(text: string): Promise<void> {
    return showModal({ text, buttons: ["OK"] }).then(() => undefined);
}

/** confirm() replacement; true when confirmed. */
export function modalConfirm(text: string, danger = false): Promise<boolean> {
    return showModal({ text, buttons: ["Yes", "Cancel"], danger }).then((r) => r.button === "Yes");
}

/** prompt() replacement; null when cancelled. */
export function modalPrompt(text: string, value = "", maxLength = 300): Promise<string | null> {
    return showModal({ text, buttons: ["OK", "Cancel"], input: { value, maxLength } })
        .then((r) => (r.button === "OK" ? r.value : null));
}

/** Multi-button choice; resolves to the clicked label (Escape picks the last). */
export function modalChoice(text: string, buttons: string[]): Promise<string> {
    return showModal({ text, buttons }).then((r) => r.button);
}

export interface ListEditorOptions {
    title: string;
    entries: string[];
    /** Noun for one entry, used on the add button ("word", "sentence", ...) */
    entryLabel?: string;
    maxChars?: number;
    maxEntries?: number;
    canEdit: boolean;
}

/**
 * Row editor for string-list settings: one input per entry with a remove
 * button, plus an add row. Resolves with the new entries on Save, or null
 * when cancelled (or when the viewer cannot edit).
 */
export function modalListEditor(options: ListEditorOptions): Promise<string[] | null> {
    const run = (): Promise<string[] | null> => new Promise((resolve) => {
        const maxEntries = options.maxEntries ?? 50;
        const overlay = document.createElement("div");
        overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.55);"
            + "z-index:100000;display:flex;align-items:center;justify-content:center;";

        const card = document.createElement("div");
        card.style.cssText = "background:#241c2e;color:#e8e2f0;border:1px solid #8469b6;"
            + "border-left:5px solid #8469b6;border-radius:8px;width:560px;max-height:80vh;"
            + "display:flex;flex-direction:column;"
            + "padding:20px 24px;font-family:system-ui,sans-serif;font-size:17px;line-height:1.5;"
            + "box-shadow:0 8px 40px rgba(0,0,0,0.6);";

        const title = document.createElement("div");
        title.textContent = `BC+ - ${options.title}`;
        title.style.cssText = "color:#b794e6;font-weight:600;margin-bottom:12px;";
        card.appendChild(title);

        const rows = document.createElement("div");
        rows.style.cssText = "overflow-y:auto;display:flex;flex-direction:column;gap:8px;margin-bottom:12px;";
        card.appendChild(rows);

        const rowInputs = new Set<HTMLInputElement>();
        const addRow = (value: string): void => {
            if (rowInputs.size >= maxEntries) {
                return;
            }
            const row = document.createElement("div");
            row.style.cssText = "display:flex;gap:8px;align-items:center;";
            const input = document.createElement("input");
            input.type = "text";
            input.value = value;
            input.maxLength = options.maxChars ?? 200;
            input.disabled = !options.canEdit;
            input.style.cssText = "flex:1;box-sizing:border-box;background:#1a1520;color:#e8e2f0;"
                + "border:1px solid #8469b6;border-radius:4px;padding:6px 10px;font-size:16px;outline:none;";
            row.appendChild(input);
            rowInputs.add(input);
            if (options.canEdit) {
                const remove = document.createElement("button");
                remove.textContent = "✕";
                remove.title = "Remove";
                remove.style.cssText = "background:#3b2e52;color:#fff;border:none;border-radius:4px;"
                    + "padding:6px 12px;font-size:16px;cursor:pointer;font-family:inherit;";
                remove.addEventListener("click", () => {
                    rowInputs.delete(input);
                    row.remove();
                });
                row.appendChild(remove);
            }
            rows.appendChild(row);
            return;
        };
        options.entries.forEach(addRow);

        if (options.canEdit) {
            const add = document.createElement("button");
            add.textContent = `+ Add ${options.entryLabel ?? "entry"}`;
            add.style.cssText = "background:#3b2e52;color:#fff;border:1px dashed #8469b6;border-radius:4px;"
                + "padding:6px 12px;font-size:16px;cursor:pointer;font-family:inherit;margin-bottom:16px;align-self:flex-start;";
            add.addEventListener("click", () => {
                addRow("");
                const inputs = [...rowInputs];
                inputs[inputs.length - 1]?.focus();
            });
            card.appendChild(add);
        }

        const buttonRow = document.createElement("div");
        buttonRow.style.cssText = "display:flex;gap:10px;justify-content:flex-end;";
        const finish = (save: boolean): void => {
            document.removeEventListener("keydown", onKey, true);
            const values = save
                ? [...rowInputs].map((input) => input.value.trim()).filter((v) => v.length > 0)
                : null;
            overlay.remove();
            resolve(values);
        };
        const onKey = (event: KeyboardEvent): void => {
            if (event.key === "Escape") {
                event.stopPropagation();
                finish(false);
            }
        };
        document.addEventListener("keydown", onKey, true);

        const labels: [string, boolean][] = options.canEdit ? [["Save", true], ["Cancel", false]] : [["Close", false]];
        for (const [label, save] of labels) {
            const btn = document.createElement("button");
            btn.textContent = label;
            btn.style.cssText = `background:${save ? "#8469b6" : "#3b2e52"};color:#fff;border:none;border-radius:4px;`
                + "padding:8px 18px;font-size:16px;cursor:pointer;font-family:inherit;";
            btn.addEventListener("click", () => finish(save));
            buttonRow.appendChild(btn);
        }
        card.appendChild(buttonRow);

        overlay.appendChild(card);
        document.body.appendChild(overlay);
    });
    const result = queue.then(run);
    queue = result.catch(() => undefined);
    return result;
}
