export {};

declare global {
    // Injected at build time by build.mjs
    const BCP_VERSION: string;
    const BCP_DEV_ENV: boolean;
    const BCP_STABLE: boolean;

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
