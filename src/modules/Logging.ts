import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig, PermissionDefinition } from "@/system/module/ModuleTypes";
import { BCPLUS_AUTHOR, BCPLUS_VERSION } from "@/system/Constants";
import { Role } from "@/system/Roles";
import { LOG_MAX_ENTRIES, LOG_REMOTE_LIMIT, LogCategory, LogEntry } from "@/system/logging/LogTypes";
import { LoggingScreen } from "@/gui/LoggingScreen";
import { GUIScreen } from "@/system/gui/GUIScreen";
import { BCPNotifyPlayer, SendBCPMessage } from "@/utils/Messaging";
import { jsonClone } from "@/utils/BCUtils";
import { AnySetting } from "@/system/gui/Settings";
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

    /** EventBus unsubscribers, cleared on Unload so re-enabling never double-logs. */
    private readonly eventUnsubs: (() => void)[] = [];

    /** The BCX API survives module toggling; subscribe to it only once. */
    private bcxSubscribed = false;

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
            {
                id: "log.praise",
                label: "Praise or scold me in my log",
                defaultRole: Role.Mistress,
                defaultSelf: false,
            },
            {
                id: "log.note",
                label: "Leave notes in my log",
                defaultRole: Role.Mistress,
                defaultSelf: false,
            },
            {
                id: "log.configure",
                label: "Configure what my log records",
                defaultRole: Role.Owner,
                defaultSelf: true,
            },
        ];
    }

    /**
     * Per-category recording toggles. Praise, scolds and notes have no toggle:
     * they are deliberate additions gated by their own permissions.
     */
    override get Settings(): AnySetting[] {
        return [
            { type: "checkbox", name: "record.rule", label: "Record rule violations and blocked attempts", default: true },
            { type: "checkbox", name: "record.curse", label: "Record curse events", default: true },
            { type: "checkbox", name: "record.authority", label: "Record permission changes", default: true },
            { type: "checkbox", name: "record.role", label: "Record role changes", default: true },
            { type: "checkbox", name: "record.relationship", label: "Record relationship changes", default: true },
            { type: "checkbox", name: "record.other", label: "Record commands and other events", default: true },
        ];
    }

    /** Changing the recording config requires log.configure - locally too. */
    override get EditPermission(): string | null {
        return "log.configure";
    }

    override get Defaults(): Record<string, unknown> {
        return { ...super.Defaults, entries: [] };
    }

    override get HasGUI(): boolean {
        return true;
    }

    override get SupportsRemote(): boolean {
        return true;
    }

    override get CanDisable(): boolean {
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
        if (this.Preset === "Dominant" || !this.Config.Active) {
            return;
        }
        // Categories without a toggle (praise/scold/note) are always recorded
        if (this.getSetting<boolean>(`record.${category}`) === false) {
            debug(`Log [${category}] suppressed by recording config: ${message}`);
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

    /** Asks another character to clear their log; their client validates log.delete. */
    requestClear(memberNumber: number): void {
        SendBCPMessage({ message: "LogClear" }, memberNumber);
    }

    override Unload(): void {
        for (const unsubscribe of this.eventUnsubs.splice(0)) {
            unsubscribe();
        }
        super.Unload();
    }

    override Load(): void {
        this.eventUnsubs.push(this.Events.on("ruleTriggered", ({ rule, type, target }) => {
            const name = this.ModuleManager.getModule<Rules>("rules")?.getDefinition(rule)?.name ?? rule;
            const suffix = target === null ? "" : ` (target #${target})`;
            this.log("rule", type === "triggerAttempt"
                ? `Blocked by rule "${name}"${suffix}`
                : `Violated rule "${name}"${suffix}`);
        }));

        this.eventUnsubs.push(this.Events.on("curseTriggered", ({ group, action }) => {
            const label = this.ModuleManager.getModule<Curses>("curses")
                ?.curseableGroups().find((g) => g.Name === group)?.Description ?? group;
            const verbs = { add: "re-applied the item to", remove: "stripped", swap: "swapped the item on", update: "reset the item on" } as const;
            this.log("curse", `The curse ${verbs[action]} ${label}`);
        }));

        // In tandem mode, BCX rule triggers land in the BC+ log too. Guarded:
        // a BCX API failure must never take down the rest of this module
        // (its absence once silently disabled all remote log listeners).
        // The BCX subscription cannot be removed, so it is made once and its
        // handler goes through log(), which checks Config.Active.
        if (!this.bcxSubscribed) {
            try {
                const bcxAPI = this.SDK.bcxAPI();
                bcxAPI?.on("ruleTrigger", (data) => {
                    // Mirror BCX's own behavior-log gate: skip triggers BCX itself
                    // would not record. Its setting-enforcement rules (loggable:
                    // false, no log text) fire this event every time they snap a
                    // BC setting back, which spammed the log.
                    let name = data.rule;
                    try {
                        const state = bcxAPI?.getRuleState(data.rule);
                        const definition = state?.ruleDefinition as {
                            name?: string;
                            triggerTexts?: { log?: string; attempt_log?: string };
                        } | null | undefined;
                        const logText = data.triggerType === "triggerAttempt"
                            ? definition?.triggerTexts?.attempt_log
                            : definition?.triggerTexts?.log;
                        if (state?.isLogged !== true || typeof logText !== "string") {
                            debug(`BCX rule trigger not logged (BCX would not log it either): ${data.rule}`);
                            return;
                        }
                        if (typeof definition?.name === "string" && definition.name.length > 0) {
                            name = definition.name;
                        }
                    } catch {
                        // On BCX API errors fall back to logging with the raw id
                    }
                    this.log("rule", `BCX rule "${name}" ${data.triggerType === "triggerAttempt" ? "blocked an action" : "was violated"}`);
                });
                this.bcxSubscribed = bcxAPI !== undefined && bcxAPI !== null;
            } catch (e) {
                warn("Could not subscribe to BCX rule triggers:", e);
            }
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

        // Remote log clearing - validated here against log.delete
        this.addSyncListener("LogClear", (sender) => {
            const senderNumber = sender.MemberNumber;
            if (typeof senderNumber !== "number") {
                return;
            }
            const authority = this.ModuleManager.getModule<Authority>("authority");
            if (!authority?.hasPermission(senderNumber, "log.delete")) {
                SendBCPMessage({ message: "LogClearResult", ok: false, reason: "no permission" }, senderNumber);
                return;
            }
            this.clear();
            BCPNotifyPlayer(`${sender.Name} (#${senderNumber}) cleared your behavior log.`);
            SendBCPMessage({ message: "LogClearResult", ok: true }, senderNumber);
        });

        this.addSyncListener("LogClearResult", (sender, content) => {
            const senderNumber = sender.MemberNumber;
            if (content.ok === false) {
                BCPNotifyPlayer(`${sender.Name} rejected the clear${typeof content.reason === "string" ? `: ${content.reason}` : "."}`);
            } else if (typeof senderNumber === "number") {
                BCPNotifyPlayer(`${sender.Name}'s log has been cleared.`);
                this.requestLog(senderNumber);
            }
        });

        // Praise/scold/notes from others - validated here, entry composed here
        this.addSyncListener("LogAdd", (sender, content) => {
            const senderNumber = sender.MemberNumber;
            if (typeof senderNumber !== "number") {
                return;
            }
            const reject = (reason: string): void => {
                SendBCPMessage({ message: "LogAddResult", ok: false, reason }, senderNumber);
            };
            if (this.Preset === "Dominant") {
                reject("their Dominant preset keeps no log");
                return;
            }
            const kind = content.kind;
            const text = typeof content.text === "string" ? content.text.slice(0, 200).trim() : "";
            const authority = this.ModuleManager.getModule<Authority>("authority");

            if (kind === "praise" || kind === "scold") {
                if (!authority?.hasPermission(senderNumber, "log.praise")) {
                    reject("no permission");
                    return;
                }
                const verb = kind === "praise" ? "praised" : "scolded";
                this.log(kind, `${sender.Name} (#${senderNumber}) ${verb} you${text ? `: ${text}` : ""}`);
                BCPNotifyPlayer(`${sender.Name} (#${senderNumber}) ${verb} you${text ? `: ${text}` : "."}`);
            } else if (kind === "note") {
                if (!authority?.hasPermission(senderNumber, "log.note")) {
                    reject("no permission");
                    return;
                }
                if (text.length === 0) {
                    reject("empty note");
                    return;
                }
                this.log("note", `Note from ${sender.Name} (#${senderNumber}): ${text}`);
                BCPNotifyPlayer(`${sender.Name} (#${senderNumber}) left a note in your log.`);
            } else {
                reject("invalid kind");
                return;
            }
            SendBCPMessage({ message: "LogAddResult", ok: true }, senderNumber);
        });

        this.addSyncListener("LogAddResult", (sender, content) => {
            const senderNumber = sender.MemberNumber;
            if (content.ok === false) {
                BCPNotifyPlayer(`${sender.Name} rejected the log entry${typeof content.reason === "string" ? `: ${content.reason}` : "."}`);
            } else if (typeof senderNumber === "number") {
                BCPNotifyPlayer("Delivered.");
                // Refresh our view of their log
                this.requestLog(senderNumber);
            }
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
