import { reactive } from "vue";
import type { InjectionKey } from "vue";

/** What the member-picker modal is currently asked for. */
export interface PickerRequest {
    title: string;
    multi: boolean;
    initial: number[];
    excluded: number[];
}

/**
 * Promise-based member picking: screens call pickPerson()/pickMembers() and
 * await the choice; the App renders one MemberPickerModal off this state.
 * Resolves null when the picker is dismissed.
 */
export class PickerService {

    readonly state = reactive<{ request: PickerRequest | null }>({ request: null });

    private resolver: ((result: number[] | null) => void) | null = null;

    pickPerson(options: { title?: string; excluded?: number[] } = {}): Promise<number | null> {
        return this.open({
            title: options.title ?? "Pick a member",
            multi: false,
            initial: [],
            excluded: options.excluded ?? [],
        }).then((result) => (result === null ? null : (result[0] ?? null)));
    }

    pickMembers(options: { title?: string; initial?: number[]; excluded?: number[] } = {}): Promise<number[] | null> {
        return this.open({
            title: options.title ?? "Pick members",
            multi: true,
            initial: options.initial ?? [],
            excluded: options.excluded ?? [],
        });
    }

    /** Called by the modal: the final choice, or null on dismissal. */
    finish(result: number[] | null): void {
        const resolve = this.resolver;
        this.resolver = null;
        this.state.request = null;
        resolve?.(result);
    }

    private open(request: PickerRequest): Promise<number[] | null> {
        // A second request while one is open dismisses the first
        this.resolver?.(null);
        this.state.request = request;
        return new Promise((resolve) => {
            this.resolver = resolve;
        });
    }
}

export const PICKER_KEY: InjectionKey<PickerService> = Symbol("bcp-picker");
