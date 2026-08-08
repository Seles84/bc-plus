import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig } from "@/system/module/ModuleTypes";
import { BCPLUS_APP_NAME, BCPLUS_AUTHOR, BCPLUS_REPO, BCPLUS_VERSION } from "@/system/Constants";
import { log, warn } from "@/system/Console";
import { InfoBeep } from "@/utils/BCUtils";
import { BCPVersionCompare, parseBCPVersion } from "@/utils/Version";

/**
 * Core housekeeping module: announces BC+ readiness and, in tandem mode,
 * connects to the BCX mod API.
 */
export default class Core extends ModuleInstance {

    protected readonly SystemConfig: ModuleConfig = {
        Name: "Core",
        Version: BCPLUS_VERSION,
        Author: BCPLUS_AUTHOR,
        Description: "BC+ core housekeeping",
        Active: true,
        Icon: "",
        HoverText: "",
        PublicData: false,
        Reference: "core",
    };

    override Load(): void {
        this.checkForUpdate();
        const mode = this.BCMode === "tandem"
            ? `tandem with BCX v${window.bcx?.version ?? "?"}`
            : "standalone";
        InfoBeep(`${BCPLUS_APP_NAME} v${BCPLUS_VERSION} Ready! (${mode})`);
        log(`Ready! Running ${mode}.`);

        if (this.BCMode === "tandem") {
            const api = this.SDK.bcxAPI();
            if (api) {
                api.on("ruleTrigger", (data) => {
                    // Placeholder: later stages react to BCX rule triggers (e.g. logging)
                    log(`BCX rule triggered: ${data.rule} (${data.triggerType})`);
                });
            }
        }
    }

    /** Notifies once after an update and stamps the save with the new version. */
    private checkForUpdate(): void {
        const save = this.Storage.Data;
        const savedVersion = parseBCPVersion(save.version);
        const current = parseBCPVersion(BCPLUS_VERSION);
        if (savedVersion === null || current === null) {
            warn(`Could not compare versions (save: ${save.version}, current: ${BCPLUS_VERSION})`);
            return;
        }
        if (BCPVersionCompare(current, savedVersion) > 0) {
            InfoBeep(`${BCPLUS_APP_NAME} updated to v${BCPLUS_VERSION}! Changelog: ${BCPLUS_REPO}/blob/main/CHANGE-LOG.md`, 8000);
        }
        if (save.version !== BCPLUS_VERSION) {
            save.version = BCPLUS_VERSION;
        }
    }
}
