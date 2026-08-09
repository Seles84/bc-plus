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
