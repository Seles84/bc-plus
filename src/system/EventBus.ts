/** All events BC+ can emit internally. Extend this map as new systems are added. */
export interface BCPlusEvents {
    /** Fired once after login when the run mode has been determined. */
    modeChanged: { mode: BCMode };
    /** Fired after every module has finished loading. */
    modulesLoaded: undefined;
    /** Fired when a single module finishes loading or unloading. */
    moduleLoaded: { slug: string };
    moduleUnloaded: { slug: string };
    /** Fired when BC+ presence/data arrives from another character in the room. */
    characterSyncReceived: { memberNumber: number };
    /** Fired when a rule is violated (trigger) or an action was blocked (triggerAttempt). */
    ruleTriggered: { rule: string; type: "trigger" | "triggerAttempt"; target: number | null };
    /** Fired when a rule is activated or deactivated. */
    ruleChanged: { rule: string; active: boolean };
}

type Listener<T> = (data: T) => void;

/** Minimal typed event emitter — avoids an external dependency for a few dozen lines. */
export class EventBus<Events extends object = BCPlusEvents> {
    private readonly listeners = new Map<keyof Events, Set<Listener<never>>>();

    on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
        }
        set.add(listener as Listener<never>);
        return () => this.off(event, listener);
    }

    once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
        const remove = this.on(event, (data) => {
            remove();
            listener(data);
        });
        return remove;
    }

    off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
        this.listeners.get(event)?.delete(listener as Listener<never>);
    }

    emit<K extends keyof Events>(event: K, data: Events[K]): void {
        this.listeners.get(event)?.forEach((listener) => {
            (listener as Listener<Events[K]>)(data);
        });
    }
}
