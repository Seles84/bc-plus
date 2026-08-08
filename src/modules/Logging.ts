import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig, PermissionDefinition } from "@/system/module/ModuleTypes";
import { BCPLUS_AUTHOR, BCPLUS_VERSION } from "@/system/Constants";
import { Role } from "@/system/Roles";
import { LOG_MAX_ENTRIES, LOG_REMOTE_LIMIT, LogCategory, LogEntry } from "@/system/logging/LogTypes";
import { LoggingScreen } from "@/gui/LoggingScreen";
import { GUIScreen } from "@/system/gui/GUIScreen";
import { SendBCPMessage } from "@/utils/Messaging";
import { jsonClone } from "@/utils/BCUtils";
import { debug, warn } from "@/system/Console";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";
import type Authority from "@/modules/Authority";
import type Rules from "@/modules/Rules";
import type Curses from "@/modules/Curses";

/**
 * The behavior log: records rule violations, curse triggers, and remote
 * changes. Entries are private - never broadcast; other BC+ users may
 * request the log and receive it only if the log.view permission allows.
 */
export default class Logging extends ModuleInstance {

    /** Fetched logs of other characters: entries, "denied", "pending", or "timeout". */
    private readonly remoteLogs = new Map<number, LogEntry[] | "denied" | "pending" | "timeout">();

    protected readonly SystemConfig: ModuleConfig = {
        Name: "Logging",
        Version: BCPLUS_VERSION,
        Author: BCPLUS_AUTHOR,
        Description: "Records rule violations, curse triggers and remote changes",
        Active: true,
        Icon: "Icons/Notifications.png",
        HoverText: "The behavior log records rule violations, blocked attempts, curse triggers and "
            + "changes made by others. Who may read or clear it is controlled in Authority - "
            + "including whether you may read your own.",
        PublicData: false,
        Reference: "logging",
        MenuString: "Log",
    };

    override get Permissions(): PermissionDefinition[] {
        return [
            {
                id: "log.view",
                label: "View my behavior log",
                defaultRole: Role.Mistress,
                defaultSelf: true,
            },
            {
                id: "log.delete",
                label: "Clear my behavior log",
                defaultRole: Role.Owner,
                defaultSelf: true,
            },
        ];
    }

    override get Defaults(): Record<string, unknown> {
        return { entries: [] };
    }

    override get HasGUI(): boolean {
        return true;
    }

    override get SupportsRemote(): boolean {
        return true;
    }

    override get SettingsScreen(): ((character: BCPlusCharacter | null) => GUIScreen) | null {
        return (character) => new LoggingScreen(this, character);
    }

    get Entries(): LogEntry[] {
        return this.Data.entries as LogEntry[];
    }

    /** Appends an entry, pruning the oldest beyond the cap. */
    log(category: LogCategory, message: string): void {
        if (this.Preset === "Dominant") {
            return;
        }
        const entries = this.Entries;
        entries.push({ time: Date.now(), category, message });
        if (entries.length > LOG_MAX_ENTRIES) {
            entries.splice(0, entries.length - LOG_MAX_ENTRIES);
        }
        debug(`Log [${category}]: ${message}`);
    }

    canView(): boolean {
        const authority = this.ModuleManager.getModule<Authority>("authority");
        return authority?.hasPermission(Player.MemberNumber ?? -1, "log.view") ?? false;
    }

    canClear(): boolean {
        const authority = this.ModuleManager.getModule<Authority>("authority");
        return authority?.hasPermission(Player.MemberNumber ?? -1, "log.delete") ?? false;
    }

    clear(): void {
        this.Entries.splice(0, this.Entries.length);
    }

    /** Requests another character's log; the result arrives via getRemoteLog. */
    requestLog(memberNumber: number): void {
        this.remoteLogs.set(memberNumber, "pending");
        SendBCPMessage({ message: "LogRequest" }, memberNumber);
        setTimeout(() => {
            if (this.remoteLogs.get(memberNumber) === "pending") {
                debug(`Log request to #${memberNumber} timed out`);
                this.remoteLogs.set(memberNumber, "timeout");
                this.Events.emit("logReceived", { memberNumber });
            }
        }, 10_000);
    }

    getRemoteLog(memberNumber: number): LogEntry[] | "denied" | "pending" | "timeout" | undefined {
        return this.remoteLogs.get(memberNumber);
    }

    override Load(): void {
        this.Events.on("ruleTriggered", ({ rule, type, target }) => {
            const name = this.ModuleManager.getModule<Rules>("rules")?.getDefinition(rule)?.name ?? rule;
            const suffix = target === null ? "" : ` (target #${target})`;
            this.log("rule", type === "triggerAttempt"
                ? `Blocked by rule "${name}"${suffix}`
                : `Violated rule "${name}"${suffix}`);
        });

        this.Events.on("curseTriggered", ({ group, action }) => {
            const label = this.ModuleManager.getModule<Curses>("curses")
                ?.curseableGroups().find((g) => g.Name === group)?.Description ?? group;
            const verbs = { add: "re-applied the item to", remove: "stripped", swap: "swapped the item on", update: "reset the item on" } as const;
            this.log("curse", `The curse ${verbs[action]} ${label}`);
        });

        // In tandem mode, BCX rule triggers land in the BC+ log too. Guarded:
        // a BCX API failure must never take down the rest of this module
        // (its absence once silently disabled all remote log listeners).
        try {
            const bcxAPI = this.SDK.bcxAPI();
            bcxAPI?.on("ruleTrigger", (data) => {
                this.log("rule", `BCX rule "${data.rule}" ${data.triggerType === "triggerAttempt" ? "blocked an action" : "was violated"}`);
            });
        } catch (e) {
            warn("Could not subscribe to BCX rule triggers:", e);
        }

        // Remote log viewing: request/response, gated by log.view on OUR side
        this.addSyncListener("LogRequest", (sender) => {
            const senderNumber = sender.MemberNumber;
            if (typeof senderNumber !== "number") {
                return;
            }
            const authority = this.ModuleManager.getModule<Authority>("authority");
            const permitted = authority?.hasPermission(senderNumber, "log.view") ?? false;
            debug(`Log request from #${senderNumber}: ${permitted ? "sending entries" : "denied"}`);
            if (!permitted) {
                SendBCPMessage({ message: "LogResponse", denied: true }, senderNumber);
                return;
            }
            SendBCPMessage({
                message: "LogResponse",
                entries: jsonClone(this.Entries.slice(-LOG_REMOTE_LIMIT)),
            }, senderNumber);
        });

        this.addSyncListener("LogResponse", (sender, content) => {
            const senderNumber = sender.MemberNumber;
            if (typeof senderNumber !== "number") {
                return;
            }
            if (content.denied === true || !Array.isArray(content.entries)) {
                this.remoteLogs.set(senderNumber, "denied");
            } else {
                const entries = (content.entries as unknown[])
                    .filter((e): e is LogEntry => typeof e === "object" && e !== null
                        && typeof (e as LogEntry).time === "number"
                        && typeof (e as LogEntry).message === "string")
                    .slice(-LOG_REMOTE_LIMIT);
                this.remoteLogs.set(senderNumber, entries);
            }
            this.Events.emit("logReceived", { memberNumber: senderNumber });
        });
    }
}
