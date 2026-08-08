import bcModSdk, { GetDotedPathType, ModSDKModAPI, PatchHook } from "bondage-club-mod-sdk";
import { BCPLUS_APP_NAME, BCPLUS_REPO, BCPLUS_SHORT_NAME, BCPLUS_VERSION } from "@/system/Constants";
import { debug } from "@/system/Console";

interface HookedFunction {
    functionName: string;
    priority: number;
    /** Slug of the module that owns this hook, or null for core hooks */
    module: string | null;
    removeHook: () => void;
}

/**
 * Wrapper around the bondage-club-mod-sdk API.
 * Tracks hooks per owning module so a module can be unloaded cleanly.
 */
export default class SDK {
    private readonly modAPI: ModSDKModAPI;
    private hooks: HookedFunction[] = [];

    constructor() {
        this.modAPI = bcModSdk.registerMod({
            name: BCPLUS_SHORT_NAME,
            fullName: BCPLUS_APP_NAME,
            version: BCPLUS_VERSION,
            repository: BCPLUS_REPO,
        }, {
            allowReplace: false,
        });
    }

    get API(): ModSDKModAPI {
        return this.modAPI;
    }

    /**
     * Hook a BC function.
     * @param module - Slug of the owning module (used by {@link removeHooks}), or null for core hooks
     * @param functionName - Name of function to hook; can contain dots (e.g. `Player.CanChange`)
     * @param priority - Higher priority hooks are called first
     * @param hook - The hook itself
     * @returns Function that removes this hook
     */
    addHook<TFunctionName extends string>(
        module: string | null,
        functionName: TFunctionName,
        priority: number,
        hook: PatchHook<GetDotedPathType<typeof globalThis, TFunctionName>>,
    ): () => void {
        const removeHook = this.modAPI.hookFunction(functionName, priority, hook);
        const entry: HookedFunction = { functionName, priority, module, removeHook };
        this.hooks.push(entry);

        return () => {
            removeHook();
            this.hooks = this.hooks.filter((h) => h !== entry);
        };
    }

    /** Removes every hook owned by the given module slug. */
    removeHooks(module: string): void {
        const owned = this.hooks.filter((h) => h.module === module);
        owned.forEach((h) => h.removeHook());
        this.hooks = this.hooks.filter((h) => h.module !== module);
    }

    /**
     * Patch a BC function's source (use sparingly - hooks are strongly preferred,
     * as patches break silently when BC changes the function body).
     */
    patchFunction(target: string, patches: Record<string, string>): void {
        this.modAPI.patchFunction(target, patches);
    }

    /** Resolves once the player has logged in and their character data is available. */
    async awaitLogin(): Promise<void> {
        if (typeof Player !== "undefined" && Player.MemberNumber !== undefined && Player.ExtensionSettings !== undefined) {
            debug("Player already logged in");
            return;
        }

        return new Promise<void>((resolve) => {
            debug("Waiting for login...");
            const removeHook = this.modAPI.hookFunction("LoginResponse", 0, (args, next) => {
                next(args);
                removeHook();
                // Give BC a moment to finish populating the Player object
                setTimeout(resolve, 1000);
            });
        });
    }

    /** Resolves once the player is inside a chat room. */
    async awaitChatRoom(): Promise<void> {
        if (typeof ChatRoomCharacter !== "undefined" && ChatRoomCharacter.length > 0) {
            return;
        }

        return new Promise<void>((resolve) => {
            const removeHook = this.modAPI.hookFunction("ChatRoomSync", 100, (args, next) => {
                const result = next(args);
                removeHook();
                resolve();
                return result;
            });
        });
    }

    /** The BCX mod API for BC+, if BCX is installed. Must use the exact name we registered with ModSDK. */
    bcxAPI(): BCX_ModAPI | undefined {
        return window.bcx?.getModApi(BCPLUS_SHORT_NAME);
    }

    bcxInstalled(): boolean {
        return window.bcx !== undefined;
    }

    unload(): void {
        this.hooks.forEach((h) => h.removeHook());
        this.hooks = [];
        this.modAPI.unload();
    }
}
