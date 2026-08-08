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

    interface BCPlusGlobal {
        version: BCPVersion;
        loaded: boolean;
    }

    interface Window {
        BCPlus?: BCPlusGlobal;
    }
}
