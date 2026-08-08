import bcModSdk, { ModSDKModAPI } from "bondage-club-mod-sdk";
import { BCPLUS_APP_NAME, BCPLUS_REPO, BCPLUS_SHORT_NAME, BCPLUS_VERSION } from "@/system/Constants";
import { debug } from "@/system/Console";

/**
 * Thin wrapper around the bondage-club-mod-sdk API.
 * Stage 1 will extend this with per-module hook tracking and removal.
 */
export default class SDK {
    private readonly modAPI: ModSDKModAPI;

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

    unload(): void {
        this.modAPI.unload();
    }
}
