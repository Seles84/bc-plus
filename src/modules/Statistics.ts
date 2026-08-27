import menuIcon from "@/assets/icons/statistics.png";
import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig, PermissionDefinition } from "@/system/module/ModuleTypes";
import { BCPLUS_AUTHOR, BCPLUS_VERSION } from "@/system/Constants";
import { Role } from "@/system/Roles";
import {
    ITEM_TIME_MAX_KEYS, REMOTE_MAP_CAPS, StatsSnapshot, sanitizeStatMap,
} from "@/system/statistics/StatTypes";
import { BCPNotifyPlayer, SafeReasonSuffix, SendBCPMessage } from "@/utils/Messaging";
import { jsonClone } from "@/utils/BCUtils";
import { debug } from "@/system/Console";
import type Authority from "@/modules/Authority";
import type Punishments from "@/modules/Punishments";
import type Welding from "@/modules/Welding";
import type Logging from "@/modules/Logging";
import type Core from "@/modules/Core";

const TICK_MS = 10_000;
/** Longest credible gap between ticks; larger gaps (sleep, freezes) are dropped. */
const MAX_TICK_DELTA_MS = 60_000;
/** How often accumulated time is written to storage (every save syncs to the BC server). */
const FLUSH_MS = 5 * 60_000;

/**
 * Fun numbers: how long you have spent bound, gagged or welded, what you were
 * wearing, and how often rules caught you. Time accumulates in memory and is
 * flushed to storage every few minutes so the save file is not synced to the
 * server on every tick.
 */
export default class Statistics extends ModuleInstance {

    private tickTimer: ReturnType<typeof setInterval> | null = null;
    private lastTick = 0;
    private lastFlush = 0;

    /** Time and counts gathered since the last flush to storage. */
    private pendingPlay = 0;
    private readonly pendingStates = new Map<string, number>();
    private readonly pendingItems = new Map<string, number>();
    private readonly pendingRules = new Map<string, number>();
    private readonly pendingCounters = new Map<string, number>();

    /** Fetched statistics of other characters. */
    private readonly remoteStats = new Map<number, StatsSnapshot | "denied" | "pending" | "timeout">();

    /** EventBus unsubscribers, cleared on Unload. */
    private readonly eventUnsubs: (() => void)[] = [];

    protected readonly SystemConfig: ModuleConfig = {
        Name: "Statistics",
        Version: BCPLUS_VERSION,
        Author: BCPLUS_AUTHOR,
        Description: "Tracks time spent bound, items worn, rule violations and more",
        Active: true,
        Icon: menuIcon,
        HoverText: "BC+ counts how your play time is spent - restrained, gagged, welded, in which "
            + "items - plus rule violations, punishments and other events. Who may view or reset "
            + "the numbers is controlled in Authority.",
        PublicData: false,
        Reference: "statistics",
        MenuString: "Statistics",
    };

    override get Permissions(): PermissionDefinition[] {
        return [
            {
                id: "stats.view",
                label: "View my statistics",
                defaultRole: Role.Mistress,
                defaultSelf: true,
            },
            {
                id: "stats.reset",
                label: "Reset my statistics",
                defaultRole: Role.Owner,
                defaultSelf: true,
            },
        ];
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

    override get Defaults(): Record<string, unknown> {
        return {
            ...super.Defaults,
            since: 0,
            play: 0,
            states: {},
            items: {},
            rules: {},
            counters: {},
        };
    }

    canView(): boolean {
        const authority = this.ModuleManager.getModule<Authority>("authority");
        return authority?.hasPermission(Player.MemberNumber ?? -1, "stats.view") ?? false;
    }

    canReset(): boolean {
        const authority = this.ModuleManager.getModule<Authority>("authority");
        return authority?.hasPermission(Player.MemberNumber ?? -1, "stats.reset") ?? false;
    }

    /** The current numbers with all pending time folded in. */
    snapshot(): StatsSnapshot {
        this.flush();
        return {
            since: typeof this.Data.since === "number" ? this.Data.since : 0,
            play: typeof this.Data.play === "number" ? this.Data.play : 0,
            states: jsonClone(this.Data.states as Record<string, number>),
            items: jsonClone(this.Data.items as Record<string, number>),
            rules: jsonClone(this.Data.rules as Record<string, number>),
            counters: jsonClone(this.Data.counters as Record<string, number>),
        };
    }

    resetStats(): void {
        this.pendingPlay = 0;
        this.pendingStates.clear();
        this.pendingItems.clear();
        this.pendingRules.clear();
        this.pendingCounters.clear();
        this.Data.since = Date.now();
        this.Data.play = 0;
        this.Data.states = {};
        this.Data.items = {};
        this.Data.rules = {};
        this.Data.counters = {};
    }

    /** Requests another character's statistics; the result arrives via getRemoteStats. */
    requestStats(memberNumber: number): void {
        this.remoteStats.set(memberNumber, "pending");
        SendBCPMessage({ message: "StatsRequest" }, memberNumber);
        setTimeout(() => {
            if (this.remoteStats.get(memberNumber) === "pending") {
                debug(`Stats request to #${memberNumber} timed out`);
                this.remoteStats.set(memberNumber, "timeout");
                this.Events.emit("statsReceived", { memberNumber });
            }
        }, 10_000);
    }

    getRemoteStats(memberNumber: number): StatsSnapshot | "denied" | "pending" | "timeout" | undefined {
        return this.remoteStats.get(memberNumber);
    }

    /** Asks another character to reset their statistics; their client validates stats.reset. */
    requestReset(memberNumber: number): void {
        SendBCPMessage({ message: "StatsReset" }, memberNumber);
    }

    override Load(): void {
        if (typeof this.Data.since !== "number" || this.Data.since <= 0) {
            this.Data.since = Date.now();
        }
        this.lastTick = Date.now();
        this.lastFlush = Date.now();
        this.tickTimer = setInterval(() => this.tick(), TICK_MS);

        this.eventUnsubs.push(this.Events.on("ruleTriggered", ({ rule, type }) => {
            this.pendingRules.set(rule, (this.pendingRules.get(rule) ?? 0) + 1);
            this.bump(type === "trigger" ? "violations" : "blocked");
            // Logging writes an entry for this event anyway, so a save is
            // already coming - fold the pending time into it for free
            this.flush();
        }));
        this.eventUnsubs.push(this.Events.on("curseTriggered", () => this.bump("curses")));
        this.eventUnsubs.push(this.Events.on("punishmentStarted", () => this.bump("punishments")));

        // Orgasm counting: BC calls this once per orgasm event; the global
        // ActivityOrgasmRuined decides whether it completes or is ruined
        this.addHook("ActivityOrgasmStart", 0, (args, next) => {
            const character = args[0] as Character | undefined;
            if (character?.IsPlayer()) {
                this.bump(ActivityOrgasmRuined ? "ruined" : "orgasms");
            }
            return next(args);
        });

        // Message counting at priority 0: any rule that blocks the message
        // never lets the chain reach this hook, so blocked sends do not count
        this.addHook("ServerSend", 0, (args, next) => {
            const [message, data] = args as [string, { Type?: string } | undefined];
            if (message === "ChatRoomChat" && data && typeof data === "object") {
                if (data.Type === "Chat") {
                    this.bump("messages");
                } else if (data.Type === "Whisper") {
                    this.bump("whispers");
                } else if (data.Type === "Emote") {
                    this.bump("emotes");
                }
            }
            return next(args);
        });

        // Remote stats viewing: request/response, gated by stats.view on OUR side
        this.addSyncListener("StatsRequest", (sender) => {
            const senderNumber = sender.MemberNumber;
            if (typeof senderNumber !== "number") {
                return;
            }
            const authority = this.ModuleManager.getModule<Authority>("authority");
            const permitted = authority?.hasPermission(senderNumber, "stats.view") ?? false;
            debug(`Stats request from #${senderNumber}: ${permitted ? "sending" : "denied"}`);
            if (!permitted) {
                SendBCPMessage({ message: "StatsResponse", denied: true }, senderNumber);
                return;
            }
            SendBCPMessage({ message: "StatsResponse", stats: this.snapshot() }, senderNumber);
        });

        this.addSyncListener("StatsResponse", (sender, content) => {
            const senderNumber = sender.MemberNumber;
            if (typeof senderNumber !== "number") {
                return;
            }
            const stats = content.stats as Record<string, unknown> | undefined;
            if (content.denied === true || typeof stats !== "object" || stats === null) {
                this.remoteStats.set(senderNumber, "denied");
            } else {
                this.remoteStats.set(senderNumber, {
                    since: typeof stats.since === "number" && Number.isFinite(stats.since) ? stats.since : 0,
                    play: typeof stats.play === "number" && Number.isFinite(stats.play) ? Math.max(0, stats.play) : 0,
                    states: sanitizeStatMap(stats.states, REMOTE_MAP_CAPS.states),
                    items: sanitizeStatMap(stats.items, REMOTE_MAP_CAPS.items),
                    rules: sanitizeStatMap(stats.rules, REMOTE_MAP_CAPS.rules),
                    counters: sanitizeStatMap(stats.counters, REMOTE_MAP_CAPS.counters),
                });
            }
            this.Events.emit("statsReceived", { memberNumber: senderNumber });
        });

        // Remote reset - validated here against stats.reset
        this.addSyncListener("StatsReset", (sender) => {
            const senderNumber = sender.MemberNumber;
            if (typeof senderNumber !== "number") {
                return;
            }
            const hardcore = this.ModuleManager.getModule<Core>("core")?.hardcoreSenderBlock(senderNumber);
            if (hardcore) {
                SendBCPMessage({ message: "StatsResetResult", ok: false, reason: hardcore }, senderNumber);
                return;
            }
            const authority = this.ModuleManager.getModule<Authority>("authority");
            if (!authority?.hasPermission(senderNumber, "stats.reset")) {
                SendBCPMessage({ message: "StatsResetResult", ok: false, reason: "no permission" }, senderNumber);
                return;
            }
            this.resetStats();
            BCPNotifyPlayer(`${sender.Name} (#${senderNumber}) reset your statistics.`);
            this.ModuleManager.getModule<Logging>("logging")
                ?.log("other", `${sender.Name} (#${senderNumber}) reset your statistics`);
            SendBCPMessage({ message: "StatsResetResult", ok: true }, senderNumber);
            SendBCPMessage({ message: "StatsResponse", stats: this.snapshot() }, senderNumber);
        });

        this.addSyncListener("StatsResetResult", (sender, content) => {
            if (content.ok === false) {
                BCPNotifyPlayer(`${sender.Name} rejected the reset${SafeReasonSuffix(content.reason)}`);
            } else {
                BCPNotifyPlayer(`${sender.Name}'s statistics have been reset.`);
            }
        });
    }

    override Unload(): void {
        if (this.tickTimer !== null) {
            clearInterval(this.tickTimer);
            this.tickTimer = null;
        }
        for (const unsubscribe of this.eventUnsubs.splice(0)) {
            unsubscribe();
        }
        this.flush();
        super.Unload();
    }

    private bump(counter: string): void {
        this.pendingCounters.set(counter, (this.pendingCounters.get(counter) ?? 0) + 1);
    }

    /** The predicates sampled every tick; ids match STATE_LABELS. */
    private stateChecks(): { id: string; check: () => boolean }[] {
        return [
            { id: "room", check: () => ServerPlayerIsInChatRoom() },
            { id: "helpless", check: () => !Player.CanInteract() },
            { id: "restrained", check: () => Player.IsRestrained() },
            { id: "gagged", check: () => Player.IsGagged() },
            { id: "blind", check: () => Player.IsBlind() },
            { id: "deaf", check: () => Player.IsDeaf() },
            { id: "chaste", check: () => Player.IsChaste() },
            { id: "plugged", check: () => Player.IsPlugged() },
            { id: "kneeling", check: () => Player.IsKneeling() },
            { id: "suspended", check: () => Player.IsSuspended() },
            { id: "enclosed", check: () => Player.IsEnclose() },
            { id: "edged", check: () => Player.IsEdged() },
            { id: "welded", check: () => this.ModuleManager.getModule<Welding>("welding")?.isWelded() === true },
            {
                id: "punished",
                check: () => {
                    const active = this.ModuleManager.getModule<Punishments>("punishments")?.Active;
                    return active !== undefined && Object.keys(active).length > 0;
                },
            },
        ];
    }

    private tick(): void {
        const now = Date.now();
        const delta = Math.min(Math.max(0, now - this.lastTick), MAX_TICK_DELTA_MS);
        this.lastTick = now;
        if (delta <= 0) {
            return;
        }

        this.pendingPlay += delta;
        for (const state of this.stateChecks()) {
            try {
                if (state.check()) {
                    this.pendingStates.set(state.id, (this.pendingStates.get(state.id) ?? 0) + delta);
                }
            } catch {
                // A single broken predicate must not stop the others
            }
        }
        for (const worn of Player.Appearance) {
            if (worn.Asset.Group.Category === "Item") {
                const name = worn.Asset.Description;
                this.pendingItems.set(name, (this.pendingItems.get(name) ?? 0) + delta);
            }
        }

        if (now - this.lastFlush >= FLUSH_MS) {
            this.flush();
        }
    }

    /** Merges pending time and counts into storage. Writing Data syncs the save to the server, so this stays infrequent. */
    private flush(): void {
        this.lastFlush = Date.now();
        const hasPending = this.pendingPlay > 0 || this.pendingStates.size > 0
            || this.pendingItems.size > 0 || this.pendingRules.size > 0 || this.pendingCounters.size > 0;
        if (!hasPending) {
            return;
        }

        this.Data.play = (typeof this.Data.play === "number" ? this.Data.play : 0) + this.pendingPlay;
        this.pendingPlay = 0;

        const states = this.Data.states as Record<string, number>;
        for (const [id, ms] of this.pendingStates) {
            states[id] = (states[id] ?? 0) + ms;
        }
        this.pendingStates.clear();

        const items = this.Data.items as Record<string, number>;
        for (const [name, ms] of this.pendingItems) {
            // Once the cap is reached, only items already tracked keep growing
            if (items[name] !== undefined || Object.keys(items).length < ITEM_TIME_MAX_KEYS) {
                items[name] = (items[name] ?? 0) + ms;
            }
        }
        this.pendingItems.clear();

        const rules = this.Data.rules as Record<string, number>;
        for (const [id, count] of this.pendingRules) {
            rules[id] = (rules[id] ?? 0) + count;
        }
        this.pendingRules.clear();

        const counters = this.Data.counters as Record<string, number>;
        for (const [id, count] of this.pendingCounters) {
            counters[id] = (counters[id] ?? 0) + count;
        }
        this.pendingCounters.clear();
    }
}
