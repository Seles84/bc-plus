import { markRaw, reactive } from "vue";
import type { Component, InjectionKey } from "vue";
import type { BCPlus } from "@/index";
import type { UIWindow } from "@/ui/Shell";

/** One entry on the window's navigation stack. */
export interface NavEntry {
    component: Component;
    title: string;
    props?: Record<string, unknown>;
}

/** Minimal navigation stack for the BC+ window (no router needed). */
export class Navigator {

    readonly stack: NavEntry[] = reactive([]);

    push(entry: NavEntry): void {
        // markRaw: component definitions must not be made reactive
        this.stack.push({ ...entry, component: markRaw(entry.component) });
    }

    pop(): void {
        if (this.stack.length > 1) {
            this.stack.pop();
        }
    }

    get depth(): number {
        return this.stack.length;
    }
}

export const BCPLUS_KEY: InjectionKey<BCPlus> = Symbol("bcplus");
export const NAV_KEY: InjectionKey<Navigator> = Symbol("bcp-nav");
export const WINDOW_KEY: InjectionKey<UIWindow> = Symbol("bcp-window");
