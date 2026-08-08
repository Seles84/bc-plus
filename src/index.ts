import { BCPLUS_APP_NAME, BCPLUS_AUTHOR, BCPLUS_VERSION } from "@/system/Constants";
import { err, log, warn } from "@/system/Console";
import SDK from "@/system/SDK";
import ModuleManager from "@/system/ModuleManager";
import StorageManager from "@/system/StorageManager";
import { EventBus } from "@/system/EventBus";
import { parseBCPVersion } from "@/utils/Version";

export class BCPlus {
    private readonly sdk: SDK = new SDK();
    private readonly events: EventBus = new EventBus();
    private readonly storage: StorageManager = new StorageManager();
    private readonly moduleManager: ModuleManager = new ModuleManager(this);
    private bcxVersion: BCXVersion | null = null;
    private mode: BCMode = "control";

    get SDK(): SDK {
        return this.sdk;
    }

    get Storage(): StorageManager {
        return this.storage;
    }

    get Events(): EventBus {
        return this.events;
    }

    get ModuleManager(): ModuleManager {
        return this.moduleManager;
    }

    /** How BC+ is running; determined once after login. */
    get Mode(): BCMode {
        return this.mode;
    }

    /** Version of the detected BCX install, or null when standalone. */
    get BCXVersion(): BCXVersion | null {
        return this.bcxVersion;
    }

    async start(): Promise<void> {
        log(`${BCPLUS_APP_NAME} v${BCPLUS_VERSION} by ${BCPLUS_AUTHOR}`);
        this.storage.onAfterSync = () => this.events.emit("saveSynced", undefined);
        await this.sdk.awaitLogin();
        this.detectBCX();
        if (!await this.storage.init()) {
            warn("Storage failed to initialize - BC+ will not load.");
            return;
        }
        await this.moduleManager.load();
    }

    /**
     * Detects BCX and sets the run mode:
     * `tandem` (BCX present, defer overlapping features) or `control` (standalone).
     * BCX loads before BC+ when both use loader userscripts, so a single
     * post-login check is sufficient.
     */
    private detectBCX(): void {
        if (window.bcx !== undefined) {
            this.bcxVersion = window.bcx.versionParsed;
            this.mode = "tandem";
            log(`BCX v${window.bcx.version} found - running in tandem mode`);
        } else {
            this.bcxVersion = null;
            this.mode = "control";
            log("BCX not found - running in control mode");
        }
        this.events.emit("modeChanged", { mode: this.mode });
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
