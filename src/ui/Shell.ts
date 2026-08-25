import { createApp, ref } from "vue";
import type { App as VueApp } from "vue";
import App from "@/ui/App.vue";
import tokensCss from "@/ui/tokens.css";
import tailwindCss from "@/ui/generated/tailwind.css";
import { BCPLUS_KEY, NAV_KEY, Navigator, WINDOW_KEY } from "@/ui/nav";
import { BCPLUS_STORAGE } from "@/system/Constants";
import { debug } from "@/system/Console";
import type { BCPlus } from "@/index";
import type Core from "@/modules/Core";

interface WindowRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

const MIN_W = 560;
const MIN_H = 400;
const TITLE_BAR_H = 44;

/**
 * The BC+ DOM window: a fixed-position host with a shadow root (BC's global
 * CSS cannot reach in, ours cannot leak out; Themed's --tmd-* custom
 * properties still inherit through) mounting the Vue app. Draggable,
 * natively resizable, minimizable, maximizable; size and position persist
 * per browser. All input events stop at the host so BC hotkeys and canvas
 * handlers never fire from inside the window.
 */
export class UIWindow {

    private host: HTMLDivElement | null = null;
    private vueApp: VueApp | null = null;
    private nav: Navigator | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private persistTimer: ReturnType<typeof setTimeout> | null = null;
    private restoreRect: WindowRect | null = null;

    /** Reactive for the Vue chrome. */
    readonly minimized = ref(false);
    readonly maximized = ref(false);

    constructor(private readonly core: BCPlus) {}

    get isOpen(): boolean {
        return this.host !== null;
    }

    open(): void {
        if (this.host) {
            return;
        }
        const host = document.createElement("div");
        host.id = "BCPUIWindow";
        const rect = this.clampRect(this.loadRect());
        Object.assign(host.style, {
            position: "fixed",
            zIndex: "9999",
            left: `${rect.x}px`,
            top: `${rect.y}px`,
            width: `${rect.w}px`,
            height: `${rect.h}px`,
            minWidth: `${MIN_W}px`,
            minHeight: `${MIN_H}px`,
            resize: "both",
            overflow: "hidden",
            borderRadius: "10px",
            boxShadow: "0 12px 40px rgba(0, 0, 0, 0.55)",
        });

        const shadow = host.attachShadow({ mode: "open" });
        for (const css of [tokensCss, tailwindCss]) {
            const style = document.createElement("style");
            style.textContent = css;
            shadow.appendChild(style);
        }
        const mount = document.createElement("div");
        mount.style.height = "100%";
        shadow.appendChild(mount);

        // Contain input: typing and clicking inside the window must never
        // reach BC's document-level handlers (hotkeys, canvas clicks)
        const containedEvents = ["keydown", "keyup", "keypress", "pointerdown", "mousedown", "mouseup", "click", "wheel", "touchstart"] as const;
        for (const type of containedEvents) {
            host.addEventListener(type, (event) => {
                if (type === "keydown" && (event as KeyboardEvent).key === "Escape") {
                    this.escapePressed();
                }
                event.stopPropagation();
            });
        }

        document.body.appendChild(host);
        this.host = host;
        this.minimized.value = false;
        this.maximized.value = false;
        this.restoreRect = null;
        this.applyTheme();

        this.nav = new Navigator();
        this.vueApp = createApp(App);
        this.vueApp.provide(BCPLUS_KEY, this.core);
        this.vueApp.provide(NAV_KEY, this.nav);
        this.vueApp.provide(WINDOW_KEY, this);
        this.vueApp.mount(mount);

        this.resizeObserver = new ResizeObserver(() => this.schedulePersist());
        this.resizeObserver.observe(host);
        debug("BC+ window opened");
    }

    close(): void {
        if (!this.host) {
            return;
        }
        this.persistNow();
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        if (this.persistTimer !== null) {
            clearTimeout(this.persistTimer);
            this.persistTimer = null;
        }
        this.vueApp?.unmount();
        this.vueApp = null;
        this.nav = null;
        this.host.remove();
        this.host = null;
        debug("BC+ window closed");
    }

    /** Esc goes back one screen; on the root it closes the window. */
    private escapePressed(): void {
        if (this.nav && this.nav.depth > 1) {
            this.nav.pop();
        } else {
            this.close();
        }
    }

    /** Applies the light/dark fallback (Themed's palette wins regardless). */
    applyTheme(): void {
        const theme = this.core.ModuleManager.getModule<Core>("core")?.getSetting<string>("uiTheme");
        this.host?.classList.toggle("bcp-light", theme === "Light");
    }

    /** Title-bar drag; the pointer stays tracked outside the window too. */
    startDrag(event: PointerEvent): void {
        const host = this.host;
        if (!host || this.maximized.value) {
            return;
        }
        const offsetX = event.clientX - host.offsetLeft;
        const offsetY = event.clientY - host.offsetTop;
        const move = (e: PointerEvent): void => {
            host.style.left = `${Math.min(window.innerWidth - 120, Math.max(60 - host.offsetWidth, e.clientX - offsetX))}px`;
            host.style.top = `${Math.min(window.innerHeight - 44, Math.max(0, e.clientY - offsetY))}px`;
        };
        const up = (): void => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            this.schedulePersist();
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    }

    toggleMinimize(): void {
        const host = this.host;
        if (!host) {
            return;
        }
        this.minimized.value = !this.minimized.value;
        if (this.minimized.value) {
            this.restoreRect ??= this.currentRect();
            host.style.height = `${TITLE_BAR_H + 2}px`;
            host.style.minHeight = "0";
            host.style.resize = "none";
        } else {
            host.style.height = `${(this.restoreRect ?? this.clampRect(null)).h}px`;
            host.style.minHeight = `${MIN_H}px`;
            host.style.resize = this.maximized.value ? "none" : "both";
            this.restoreRect = null;
        }
    }

    toggleMaximize(): void {
        const host = this.host;
        if (!host) {
            return;
        }
        if (this.minimized.value) {
            this.toggleMinimize();
        }
        this.maximized.value = !this.maximized.value;
        if (this.maximized.value) {
            this.restoreRect = this.currentRect();
            Object.assign(host.style, {
                left: "10px", top: "10px",
                width: "calc(100vw - 20px)", height: "calc(100vh - 20px)",
                resize: "none",
            });
        } else {
            const rect = this.clampRect(this.restoreRect);
            this.restoreRect = null;
            Object.assign(host.style, {
                left: `${rect.x}px`, top: `${rect.y}px`,
                width: `${rect.w}px`, height: `${rect.h}px`,
                resize: "both",
            });
        }
    }

    // -------------------------------------------------------- Persistence

    private rectKey(): string {
        return `${BCPLUS_STORAGE}_${Player.MemberNumber}_UIWindow`;
    }

    private currentRect(): WindowRect {
        const host = this.host!;
        return { x: host.offsetLeft, y: host.offsetTop, w: host.offsetWidth, h: host.offsetHeight };
    }

    private schedulePersist(): void {
        if (this.persistTimer !== null) {
            clearTimeout(this.persistTimer);
        }
        this.persistTimer = setTimeout(() => this.persistNow(), 400);
    }

    private persistNow(): void {
        if (!this.host || this.minimized.value || this.maximized.value) {
            return;
        }
        try {
            localStorage.setItem(this.rectKey(), JSON.stringify(this.currentRect()));
        } catch {
            // Remembering the window is a convenience only
        }
    }

    private loadRect(): WindowRect | null {
        try {
            const raw = localStorage.getItem(this.rectKey());
            if (!raw) {
                return null;
            }
            const rect = JSON.parse(raw) as Partial<WindowRect>;
            if ([rect.x, rect.y, rect.w, rect.h].every((v) => typeof v === "number" && Number.isFinite(v))) {
                return rect as WindowRect;
            }
        } catch {
            // Corrupt or blocked storage - fall through to defaults
        }
        return null;
    }

    /** Keeps the window on screen and at sane dimensions. */
    private clampRect(rect: WindowRect | null): WindowRect {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const w = Math.min(Math.max(rect?.w ?? Math.min(920, vw - 60), MIN_W), Math.max(MIN_W, vw - 20));
        const h = Math.min(Math.max(rect?.h ?? Math.min(660, vh - 60), MIN_H), Math.max(MIN_H, vh - 20));
        const x = Math.min(Math.max(rect?.x ?? (vw - w) / 2, 0), Math.max(0, vw - 120));
        const y = Math.min(Math.max(rect?.y ?? (vh - h) / 2, 0), Math.max(0, vh - 44));
        return { x, y, w, h };
    }
}
