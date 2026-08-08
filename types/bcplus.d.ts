export {};

declare global {
    // Injected at build time by build.mjs
    const BCP_VERSION: string;
    const BCP_DEV_ENV: boolean;
    const BCP_STABLE: boolean;
    /** HMAC key marking saves as written by an official build; empty in unofficial/dev builds */
    const BCP_SAVE_KEY: string;

    interface BCPVersion {
        major: number;
        minor: number;
        patch: number;
        extra?: string;
        dev?: boolean;
    }

    /**
     * How BC+ is running:
     * - `control` - standalone, BCX not present
     * - `tandem` - alongside BCX, deferring overlapping features to it
     */
    type BCMode = "control" | "tandem";

    interface BCPlusGlobal {
        version: BCPVersion;
        loaded: boolean;
    }

    interface Window {
        BCPlus?: BCPlusGlobal;
    }
}
