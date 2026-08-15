import { err } from "@/system/Console";
import type { GUI } from "@/modules/GUI";

const STYLE_ID = "BCP_modalStyles";
const PANEL_ID = "BCP_modalPanel";
const PILL_ID = "BCP_modalPill";
/** Above BC's UI; BCP_ inputs are raised above this while the modal is open. */
const Z_INDEX = 99_960;

/**
 * Floating window host for the BC+ canvas GUI (modal mode): a draggable
 * DOM panel with its own canvas that the regular screen system renders
 * into. While a frame is rendered (or a click dispatched), the global
 * `MainCanvas` is swapped to this canvas - every Draw* helper and screen
 * works unchanged, and the club stays visible and usable underneath.
 */
export class ModalHost {

    private panel: HTMLDivElement | null = null;
    private pill: HTMLDivElement | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;
    private frame: number | null = null;
    private minimized = false;
    /** Modal-space mouse position (2000x1000 units; -1 = outside). */
    private mouseX = -1;
    private mouseY = -1;

    constructor(private readonly gui: GUI) {}

    get Active(): boolean {
        return this.panel !== null && this.frame !== null;
    }

    /** True while a render/click swap is in progress (for the element hooks). */
    swapped = false;

    open(): void {
        this.build();
        this.panel!.style.display = "flex";
        this.pill!.style.display = "none";
        this.minimized = false;
        document.body.classList.add("BCP-modal-open");
        if (this.frame === null) {
            const loop = (): void => {
                this.renderFrame();
                this.frame = this.frame === null ? null : requestAnimationFrame(loop);
            };
            this.frame = requestAnimationFrame(loop);
        }
    }

    close(): void {
        if (this.frame !== null) {
            cancelAnimationFrame(this.frame);
            this.frame = null;
        }
        document.body.classList.remove("BCP-modal-open");
        if (this.panel) {
            this.panel.style.display = "none";
        }
        if (this.pill) {
            this.pill.style.display = "none";
        }
        this.minimized = false;
    }

    destroy(): void {
        this.close();
        this.panel?.remove();
        this.pill?.remove();
        document.getElementById(STYLE_ID)?.remove();
        this.panel = null;
        this.pill = null;
        this.canvas = null;
        this.ctx = null;
    }

    /** Places one of our DOM inputs over the modal canvas (viewport-accurate). */
    positionElement(element: HTMLElement, x: number, y: number, w: number, h: number): void {
        if (!this.canvas) {
            return;
        }
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = rect.width / 2000;
        const scaleY = rect.height / 1000;
        const height = h * scaleY;
        element.style.position = "fixed";
        element.style.left = `${rect.left + (x - w / 2) * scaleX}px`;
        element.style.top = `${rect.top + (y - h / 2) * scaleY}px`;
        element.style.width = `${w * scaleX}px`;
        element.style.height = `${height}px`;
        element.style.fontSize = `${Math.max(10, Math.round(height * 0.55))}px`;
        element.style.zIndex = String(Z_INDEX + 10);
    }

    private minimize(): void {
        this.minimized = true;
        this.panel!.style.display = "none";
        this.pill!.style.display = "flex";
    }

    private restore(): void {
        this.minimized = false;
        this.panel!.style.display = "flex";
        this.pill!.style.display = "none";
    }

    /** Renders the current subscreen into the modal canvas. */
    private renderFrame(): void {
        const subscreen = this.gui.CurrentSubscreen;
        if (!subscreen) {
            // Navigated out of the last screen - the window closes itself
            this.close();
            return;
        }
        if (this.minimized || !this.ctx) {
            return;
        }
        const darkTheme = Player?.ChatSettings?.ColorTheme === "Dark" || Player?.ChatSettings?.ColorTheme === "Dark2";
        const prevMainCanvas = MainCanvas;
        const prevMouseX = MouseX;
        const prevMouseY = MouseY;
        this.swapped = true;
        try {
            MainCanvas = this.ctx;
            MouseX = this.mouseX;
            MouseY = this.mouseY;
            this.ctx.clearRect(0, 0, 2000, 1000);
            this.ctx.fillStyle = darkTheme ? "#1f1f24" : "#ffffff";
            this.ctx.fillRect(0, 0, 2000, 1000);
            subscreen.render();
        } catch (e) {
            err("Modal render failed:", e);
        } finally {
            this.swapped = false;
            MainCanvas = prevMainCanvas;
            MouseX = prevMouseX;
            MouseY = prevMouseY;
        }
    }

    /** Dispatches a click at modal-space coordinates through the subscreen. */
    private dispatchClick(x: number, y: number): void {
        const subscreen = this.gui.CurrentSubscreen;
        if (!subscreen || !this.ctx) {
            return;
        }
        const prevMainCanvas = MainCanvas;
        const prevMouseX = MouseX;
        const prevMouseY = MouseY;
        this.swapped = true;
        try {
            MainCanvas = this.ctx;
            MouseX = x;
            MouseY = y;
            subscreen.click();
        } catch (e) {
            err("Modal click failed:", e);
        } finally {
            this.swapped = false;
            MainCanvas = prevMainCanvas;
            MouseX = prevMouseX;
            MouseY = prevMouseY;
        }
    }

    private toModalSpace(event: MouseEvent): { x: number; y: number } {
        const rect = this.canvas!.getBoundingClientRect();
        return {
            x: Math.round((event.clientX - rect.left) / rect.width * 2000),
            y: Math.round((event.clientY - rect.top) / rect.height * 1000),
        };
    }

    private build(): void {
        if (this.panel) {
            return;
        }
        this.injectStyles();

        const panel = document.createElement("div");
        panel.id = PANEL_ID;

        const header = document.createElement("div");
        header.className = "BCP-modal-header";
        const title = document.createElement("div");
        title.className = "BCP-modal-title";
        title.textContent = "BC+";
        const minButton = document.createElement("div");
        minButton.className = "BCP-modal-hbtn";
        minButton.textContent = "–";
        minButton.title = "Minimize";
        minButton.addEventListener("click", () => this.minimize());
        const closeButton = document.createElement("div");
        closeButton.className = "BCP-modal-hbtn";
        closeButton.textContent = "✕";
        closeButton.title = "Close";
        closeButton.addEventListener("click", () => {
            this.gui.closeSubscreen();
            this.close();
        });
        header.append(title, minButton, closeButton);

        const canvas = document.createElement("canvas");
        canvas.className = "BCP-modal-canvas";
        canvas.width = 2000;
        canvas.height = 1000;
        canvas.addEventListener("mousemove", (event) => {
            const { x, y } = this.toModalSpace(event);
            this.mouseX = x;
            this.mouseY = y;
        });
        canvas.addEventListener("mouseleave", () => {
            this.mouseX = -1;
            this.mouseY = -1;
        });
        canvas.addEventListener("click", (event) => {
            event.stopPropagation();
            const { x, y } = this.toModalSpace(event);
            this.dispatchClick(x, y);
        });

        panel.append(header, canvas);
        document.body.appendChild(panel);

        // Dragging by the header, keeping it reachable
        const drag = { on: false, offsetX: 0, offsetY: 0 };
        header.addEventListener("mousedown", (event) => {
            if (event.target === minButton || event.target === closeButton) {
                return;
            }
            drag.on = true;
            const rect = panel.getBoundingClientRect();
            drag.offsetX = event.clientX - rect.left;
            drag.offsetY = event.clientY - rect.top;
            panel.style.transform = "none";
            event.preventDefault();
        });
        document.addEventListener("mousemove", (event) => {
            if (!drag.on) {
                return;
            }
            const width = panel.offsetWidth;
            let left = event.clientX - drag.offsetX;
            let top = event.clientY - drag.offsetY;
            top = Math.max(0, Math.min(top, window.innerHeight - 40));
            left = Math.max(80 - width, Math.min(left, window.innerWidth - 80));
            panel.style.left = `${left}px`;
            panel.style.top = `${top}px`;
        });
        document.addEventListener("mouseup", () => {
            drag.on = false;
        });

        // Escape steps back one screen (unless typing in an input)
        document.addEventListener("keydown", (event) => {
            if (!this.Active || this.minimized || (event.key !== "Escape" && event.key !== "Esc")) {
                return;
            }
            const target = event.target as HTMLElement | null;
            if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
                return;
            }
            this.gui.CurrentSubscreen?.exit();
            event.stopPropagation();
        }, true);

        const pill = document.createElement("div");
        pill.id = PILL_ID;
        pill.innerHTML = "<span class='BCP-modal-pill-dash'></span> BC+";
        pill.title = "Restore the BC+ window";
        pill.addEventListener("click", () => this.restore());
        document.body.appendChild(pill);

        this.panel = panel;
        this.pill = pill;
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
    }

    private injectStyles(): void {
        if (document.getElementById(STYLE_ID)) {
            return;
        }
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
#${PANEL_ID}{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(1300px,94vw);
  background:#1e1730;border:2px solid #8469b6;border-radius:12px;box-shadow:0 12px 60px rgba(0,0,0,.7);
  z-index:${Z_INDEX};display:none;flex-direction:column;overflow:hidden;}
#${PANEL_ID} .BCP-modal-header{display:flex;align-items:center;gap:8px;padding:6px 14px;cursor:move;
  background:linear-gradient(135deg,#2a2048,#1e1730);border-bottom:1px solid #8469b6;min-height:38px;user-select:none;}
#${PANEL_ID} .BCP-modal-title{flex:1;color:#b794e6;font-weight:700;letter-spacing:2px;font-size:13px;
  font-family:'Segoe UI',Roboto,sans-serif;}
#${PANEL_ID} .BCP-modal-hbtn{width:26px;height:26px;border-radius:50%;background:#2a2048;border:1px solid #8469b6;
  color:#c8b2e8;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:15px;line-height:1;}
#${PANEL_ID} .BCP-modal-hbtn:hover{background:#3b2e52;color:#f2eefa;}
#${PANEL_ID} .BCP-modal-canvas{display:block;width:100%;aspect-ratio:2/1;cursor:default;}
#${PILL_ID}{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);height:36px;padding:0 18px;
  background:#1e1730;border:2px solid #8469b6;border-radius:18px;display:none;align-items:center;gap:8px;
  cursor:pointer;z-index:${Z_INDEX};color:#b794e6;font-weight:700;font-size:12px;letter-spacing:1.5px;
  font-family:'Segoe UI',Roboto,sans-serif;user-select:none;}
#${PILL_ID}:hover{background:#2a2048;color:#f2eefa;}
.BCP-modal-pill-dash{width:26px;height:4px;background:#8469b6;border-radius:2px;display:inline-block;}
`;
        document.head.appendChild(style);
    }
}
