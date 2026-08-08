import { BCPLUS_APP_NAME, BCPLUS_AUTHOR, BCPLUS_VERSION } from "@/system/Constants";
import { err, log, warn } from "@/system/Console";
import SDK from "@/system/SDK";
import { parseBCPVersion } from "@/utils/Version";
import { InfoBeep } from "@/utils/BCUtils";

export class BCPlus {
    private readonly sdk: SDK = new SDK();

    get SDK(): SDK {
        return this.sdk;
    }

    async start(): Promise<void> {
        log(`${BCPLUS_APP_NAME} v${BCPLUS_VERSION} by ${BCPLUS_AUTHOR}`);
        await this.sdk.awaitLogin();
        InfoBeep(`${BCPLUS_APP_NAME} v${BCPLUS_VERSION} Ready!`);
        log("Ready!");
    }
}

if (window.BCPlus !== undefined) {
    warn("BC+ is already loaded, skipping duplicate initialization.");
} else {
    const version = parseBCPVersion(BCPLUS_VERSION);
    if (version === null) {
        err(`Invalid build version: ${BCPLUS_VERSION}`);
    } else {
        window.BCPlus = {
            version,
            loaded: true,
        };
        new BCPlus().start().catch((e) => err("Failed to start:", e));
    }
}
