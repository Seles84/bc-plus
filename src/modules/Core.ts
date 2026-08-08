import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig } from "@/system/module/ModuleTypes";
import { BCPLUS_APP_NAME, BCPLUS_AUTHOR, BCPLUS_REPO, BCPLUS_VERSION } from "@/system/Constants";
import { log, warn } from "@/system/Console";
import { InfoBeep } from "@/utils/BCUtils";
import { BCPVersionCompare, parseBCPVersion } from "@/utils/Version";
import { AnySetting } from "@/system/gui/Settings";
import { confirmBox } from "@/system/Console";
import { BCPNotifyPlayer } from "@/utils/Messaging";
import type Authority from "@/modules/Authority";

export type BCPPreset = "Dominant" | "Switch" | "Submissive" | "Slave";
export const PRESETS: readonly BCPPreset[] = ["Dominant", "Switch", "Submissive", "Slave"];

/** Permissions the Slave preset removes self-access to. */
const SLAVE_LOCKED_PERMISSIONS = ["rules.edit", "curses.edit", "authority.edit"];

/**
 * Core housekeeping module: run preset, update notifications and, in tandem
 * mode, the BCX connection.
 */
export default class Core extends ModuleInstance {

    protected readonly SystemConfig: ModuleConfig = {
        Name: "Core",
        Version: BCPLUS_VERSION,
        Author: BCPLUS_AUTHOR,
        Description: "BC+ core housekeeping",
        Active: true,
        Icon: "Icons/General.png",
        HoverText: "General BC+ settings: notifications and core behavior.",
        PublicData: false,
        Reference: "core",
        MenuString: "General",
    };

    override get Settings(): AnySetting[] {
        return [
            {
                type: "option",
                name: "preset",
                label: "Play preset",
                hoverText: "Dominant: BC+ rules, curses and logging never apply to you. "
                    + "Switch/Submissive: everything available. "
                    + "Slave: locks you out of changing your own rules, curses and permissions.",
                options: [...PRESETS],
                default: "Switch",
                onSet: (value, prev) => this.onPresetChanged(value as BCPPreset, prev as BCPPreset),
            },
            {
                type: "checkbox",
                name: "updateNotify",
                label: "Notify me in-club after BC+ updates",
                default: true,
            },
        ];
    }

    /** The player's current preset. */
    getPreset(): BCPPreset {
        const value = this.getSetting<string>("preset");
        return (PRESETS as readonly string[]).includes(value) ? value as BCPPreset : "Switch";
    }

    private onPresetChanged(value: BCPPreset, prev: BCPPreset): void {
        if (value === "Slave") {
            if (!confirmBox(
                "The Slave preset removes your OWN access to change your rules, curses and permissions.\n"
                + "Only people your permissions allow (e.g. your Owner) will be able to change them for you.\n"
                + "Are you sure?",
            )) {
                this.setSetting("preset", prev);
                return;
            }
            const authority = this.ModuleManager.getModule<Authority>("authority");
            for (const permission of SLAVE_LOCKED_PERMISSIONS) {
                authority?.setSetting(`${permission}.self`, false);
            }
            BCPNotifyPlayer("Slave preset applied: your rules, curses and permissions are now in others' hands.");
        } else if (prev === "Slave") {
            // Leaving Slave does NOT restore self-access automatically - that
            // is up to whoever holds authority.edit (possibly still you, if
            // it was never locked or someone restored it).
            BCPNotifyPlayer(`Preset changed to ${value}. Self-access permissions are not restored automatically.`);
        }
        if (value === "Dominant") {
            BCPNotifyPlayer("Dominant preset: BC+ rules, curses and logging will not apply to you.");
        }
        (this.ModuleManager.getModule("rules") as { applyPreset?: () => void } | undefined)?.applyPreset?.();
    }

    override Load(): void {
        this.checkForUpdate();
        const mode = this.BCMode === "tandem"
            ? `tandem with BCX v${window.bcx?.version ?? "?"}`
            : "standalone";
        InfoBeep(`${BCPLUS_APP_NAME} v${BCPLUS_VERSION} Ready! (${mode})`);
        log(`Ready! Running ${mode}.`);

        // BCX rule triggers are recorded by the Logging module in tandem mode
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
        if (BCPVersionCompare(current, savedVersion) > 0 && this.getSetting<boolean>("updateNotify")) {
            InfoBeep(`${BCPLUS_APP_NAME} updated to v${BCPLUS_VERSION}! Changelog: ${BCPLUS_REPO}/blob/main/CHANGE-LOG.md`, 8000);
        }
        if (save.version !== BCPLUS_VERSION) {
            save.version = BCPLUS_VERSION;
        }
    }
}
