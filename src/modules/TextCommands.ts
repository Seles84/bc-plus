import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig } from "@/system/module/ModuleTypes";
import { BCPLUS_APP_NAME, BCPLUS_AUTHOR, BCPLUS_VERSION } from "@/system/Constants";
import { LOG_MAX_ENTRIES, formatLogTime } from "@/system/logging/LogTypes";
import { STATE_LABELS, formatStatDuration } from "@/system/statistics/StatTypes";
import { ListSyncListeners, NotifyPlayer } from "@/utils/Messaging";
import { getAllCharactersInRoom } from "@/utils/BCPlusCharacter";
import { parseBCPVersion } from "@/utils/Version";
import type Rules from "@/modules/Rules";
import type Curses from "@/modules/Curses";
import type Logging from "@/modules/Logging";
import type Statistics from "@/modules/Statistics";
import type DataSync from "@/modules/DataSync";
import type Core from "@/modules/Core";
import type Welding from "@/modules/Welding";
import type { GUI as GUIModule } from "@/modules/GUI";

const COMMAND_TAG = "bcp";

interface BCPCommand {
    name: string;
    description: string;
    handler: (args: string[]) => void;
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Chat command interface: /bcp <subcommand>. All output is local-only. */
export default class TextCommands extends ModuleInstance {

    protected readonly SystemConfig: ModuleConfig = {
        Name: "TextCommands",
        Version: BCPLUS_VERSION,
        Author: BCPLUS_AUTHOR,
        Description: "Chat commands under /bcp",
        Active: true,
        Icon: "",
        HoverText: "",
        PublicData: false,
        Reference: "text-commands",
    };

    private readonly commands: BCPCommand[] = [
        {
            name: "help",
            description: "Show this command list",
            handler: () => this.showHelp(),
        },
        {
            name: "version",
            description: "Show BC+ version and run mode",
            handler: () => {
                const mode = this.Core.Mode === "tandem"
                    ? `tandem with BCX v${window.bcx?.version ?? "?"}`
                    : "standalone (control mode)";
                this.reply(`${BCPLUS_APP_NAME} v${BCPLUS_VERSION} - running ${mode}.`);
            },
        },
        {
            name: "who",
            description: "List BC+ users in the room",
            handler: () => {
                const users = getAllCharactersInRoom().filter((c) => c.BCPVersion !== null);
                if (users.length === 0) {
                    this.reply("Nobody in the room runs BC+.");
                    return;
                }
                this.reply(["BC+ users here:", ...users.map((c) =>
                    `- ${escapeHtml(c.toNicknamedString())} (v${escapeHtml(c.BCPVersion ?? "?")})`,
                )].join("<br>"));
            },
        },
        {
            name: "rules",
            description: "List your rules and their states",
            handler: () => {
                const rules = this.ModuleManager.getModule<Rules>("rules");
                if (!rules) {
                    return;
                }
                const lines = rules.Definitions.map((definition) => {
                    const state = rules.ruleState(definition.id);
                    const status = state.active
                        ? `active${state.enforce ? ", enforced" : ""}${state.log ? ", logged" : ""}`
                        : "inactive";
                    return `- ${escapeHtml(definition.name)}: ${status}`;
                });
                this.reply(["Your rules:", ...lines].join("<br>"));
            },
        },
        {
            name: "curses",
            description: "List your cursed slots",
            handler: () => {
                const curses = this.ModuleManager.getModule<Curses>("curses");
                if (!curses) {
                    return;
                }
                const slots = Object.values(curses.Slots);
                if (slots.length === 0) {
                    this.reply("No slots are cursed.");
                    return;
                }
                const lines = slots.map((slot) => {
                    const label = curses.curseableGroups().find((g) => g.Name === slot.group)?.Description ?? slot.group;
                    const summary = slot.items.length === 0
                        ? "cursed empty"
                        : `${slot.items.length} allowed item${slot.items.length === 1 ? "" : "s"}`;
                    return `- ${escapeHtml(label)}: ${slot.active ? summary : "inactive"}`;
                });
                this.reply(["Your curses:", ...lines].join("<br>"));
            },
        },
        {
            name: "log",
            description: "Show your newest log entries (log [count])",
            handler: (args) => {
                const logging = this.ModuleManager.getModule<Logging>("logging");
                if (!logging) {
                    return;
                }
                if (!logging.canView()) {
                    this.reply("You are not permitted to view your own log.");
                    return;
                }
                const requested = Number.parseInt(args[0] ?? "5", 10);
                const count = Math.min(Number.isInteger(requested) && requested > 0 ? requested : 5, 20);
                const entries = logging.Entries.slice(-count).reverse();
                if (entries.length === 0) {
                    this.reply("The log is empty.");
                    return;
                }
                this.reply([
                    `Newest ${entries.length} log entr${entries.length === 1 ? "y" : "ies"} (of max ${LOG_MAX_ENTRIES}):`,
                    ...entries.map((e) => `- ${formatLogTime(e.time)} [${e.category}] ${escapeHtml(e.message)}`),
                ].join("<br>"));
            },
        },
        {
            name: "stats",
            description: "Show a quick statistics summary",
            handler: () => {
                const statistics = this.ModuleManager.getModule<Statistics>("statistics");
                if (!statistics || !statistics.Config.Active) {
                    this.reply("The Statistics module is off.");
                    return;
                }
                if (!statistics.canView()) {
                    this.reply("You are not permitted to view your own statistics.");
                    return;
                }
                const stats = statistics.snapshot();
                const topStates = STATE_LABELS
                    .map((state) => ({ label: state.label, ms: stats.states[state.id] ?? 0 }))
                    .filter((state) => state.ms > 0)
                    .sort((a, b) => b.ms - a.ms)
                    .slice(0, 3);
                const lines = [
                    `Statistics since ${new Date(stats.since).toLocaleDateString()}:`,
                    `- Play time: ${formatStatDuration(stats.play)}`,
                    ...topStates.map((state) => `- ${state.label}: ${formatStatDuration(state.ms)}`),
                    `- Rules violated: ${stats.counters.violations ?? 0} (plus ${stats.counters.blocked ?? 0} blocked attempts)`,
                    "See the BC+ Statistics page for everything else.",
                ];
                this.reply(lines.join("<br>"));
            },
        },
        {
            name: "menu",
            description: "Open the BC+ window (modal mode)",
            handler: () => {
                const gui = this.ModuleManager.getModule<GUIModule>("gui");
                if (gui?.modalModeEnabled() !== true) {
                    this.reply("Modal mode is off - enable \"Open BC+ in a floating window\" on the BC+ General page first.");
                    return;
                }
                if (!gui.openModalMenu()) {
                    this.reply("Could not open the BC+ window.");
                }
            },
        },
        {
            name: "sync",
            description: "Re-announce BC+ and sync data with the room",
            handler: () => {
                this.ModuleManager.getModule<DataSync>("data-sync")?.settingSync(true);
                this.reply("Sync sent to the room.");
            },
        },
        {
            name: "updates",
            description: "Turn update notifications on or off (updates on|off)",
            handler: (args) => {
                const core = this.ModuleManager.getModule<Core>("core");
                if (!core) {
                    return;
                }
                const value = (args[0] ?? "").toLowerCase();
                if (value !== "on" && value !== "off") {
                    this.reply(`Update notifications are ${core.getSetting<boolean>("updateNotify") !== false ? "on" : "off"}, `
                        + `re-checking every ${core.getSetting<string>("updateCheckInterval")?.toLowerCase() ?? "1 hour"} `
                        + "(configurable on the General page). Usage: /bcp updates on|off");
                    return;
                }
                core.setSetting("updateNotify", value === "on");
                this.reply(value === "on"
                    ? "Update notifications are on."
                    : "Update notifications are off. Turn them back on with /bcp updates on "
                        + "or the checkbox on the BC+ General page.");
            },
        },
        {
            name: "weld",
            description: "Show or initiate the welding of your collar",
            handler: () => {
                const welding = this.ModuleManager.getModule<Welding>("welding");
                if (!welding) {
                    return;
                }
                const info = welding.WeldInfo;
                if (info) {
                    this.reply(`Your collar is welded shut - owner ${escapeHtml(info.ownerName)} (#${info.owner}), `
                        + `witnessed by ${escapeHtml(info.witnessName)}. Only your owner releasing you undoes it.`);
                    return;
                }
                const ceremony = welding.Ceremony;
                if (ceremony) {
                    this.reply(`A welding is in progress (${ceremony.accepted.length}/3 accepted). `
                        + "See the BC+ Welding page for details.");
                    return;
                }
                const result = welding.startCeremony(Player.MemberNumber ?? -1);
                this.reply(result === true
                    ? "Welding initiated - all three of you must accept within 10 minutes. "
                        + "Choose your witness on the BC+ Welding page."
                    : `Cannot start a welding: ${escapeHtml(result)}.`);
            },
        },
        {
            name: "accept",
            description: "Accept a pending welding request",
            handler: () => {
                const result = this.ModuleManager.getModule<Welding>("welding")?.acceptAsPlayer()
                    ?? "welding is unavailable";
                this.reply(result === true ? "Acceptance sent." : escapeHtml(result));
            },
        },
        {
            name: "decline",
            description: "Decline or cancel a welding request",
            handler: () => {
                const result = this.ModuleManager.getModule<Welding>("welding")?.declineAsPlayer()
                    ?? "welding is unavailable";
                this.reply(result === true ? "Declined." : escapeHtml(result));
            },
        },
        {
            name: "reset",
            description: "Factory reset: wipe ALL BC+ data (rules, curses, roles, permissions, log)",
            handler: () => {
                if (this.ModuleManager.getModule<Welding>("welding")?.isWelded()) {
                    this.reply("Factory reset is disabled while your collar is welded.");
                    return;
                }
                this.reply("Factory reset requested - confirm in the popup. This wipes every BC+ "
                    + "setting, rule, curse, role and log entry, then reloads the club.");
                setTimeout(() => {
                    void this.Storage.wipeAllData(true).then((wiped) => {
                        if (wiped) {
                            this.reply("BC+ has been reset. Reloading...");
                            setTimeout(() => window.location.reload(), 1500);
                        } else {
                            this.reply("Reset cancelled.");
                        }
                    });
                }, 100);
            },
        },
        // Dev-build-only helpers to exercise things that normally need a deploy
        ...(BCP_DEV_ENV ? [{
            name: "test",
            description: "DEV: test helpers (test version [x.y.z|clear])",
            handler: (args: string[]) => this.handleTest(args),
        }, {
            name: "unweld",
            description: "DEV: break the weld on your collar directly",
            handler: () => {
                const done = this.ModuleManager.getModule<Welding>("welding")?.devUnweld() === true;
                this.reply(done
                    ? "The weld has been broken (dev override)."
                    : "Your collar is not welded.");
            },
        }, {
            name: "weldage",
            description: "DEV: backdate the weld (weldage <days>) to test anniversaries",
            handler: (args: string[]) => {
                const days = Number(args[0]);
                const done = Number.isFinite(days) && days >= 0
                    && this.ModuleManager.getModule<Welding>("welding")?.devSetWeldAge(days) === true;
                this.reply(done
                    ? `The weld now dates back ${days} days (dev override).`
                    : "Usage: weldage <days> - and your collar must be welded.");
            },
        }, {
            name: "checkupdate",
            description: "DEV: force an immediate update-manifest fetch",
            handler: () => {
                this.ModuleManager.getModule<Core>("core")?.devForceUpdateCheck();
                this.reply("Update check sent - watch for the notice (or nothing if you are current).");
            },
        }] : []),
        {
            name: "debug",
            description: "Show BC+ diagnostic state",
            handler: () => {
                const modules = this.ModuleManager.Modules
                    .map((m) => `${m.Slug}${m.Config.Active ? "" : " (inactive)"}`)
                    .join(", ");
                const listeners = ListSyncListeners().join(" | ");
                const room = getAllCharactersInRoom()
                    .filter((c) => !c.isPlayer())
                    .map((c) => {
                        const data = c.BCPData ? Object.keys(c.BCPData).join("/") : "none";
                        return `- ${escapeHtml(c.toNicknamedString())}: ${c.BCPVersion ? `v${escapeHtml(c.BCPVersion)}` : "no BC+"}, mirror: ${escapeHtml(data)}`;
                    });
                this.reply([
                    `BC+ v${BCPLUS_VERSION} (${this.Core.Mode} mode)`,
                    `Modules: ${escapeHtml(modules)}`,
                    `Listeners: ${escapeHtml(listeners)}`,
                    "Room:",
                    ...(room.length > 0 ? room : ["- nobody else here"]),
                ].join("<br>"));
            },
        },
    ];

    override Load(): void {
        CommandCombine({
            Tag: COMMAND_TAG,
            Description: ": BC+ commands (/bcp help)",
            Action: (_argumentsString, _message, args) => {
                this.dispatch(args);
            },
        });
    }

    override Unload(): void {
        const index = Commands.findIndex((c) => c.Tag === COMMAND_TAG);
        if (index !== -1) {
            Commands.splice(index, 1);
        }
        super.Unload();
    }

    /** Commands that stay usable under the hardcore self-block: reading what
     * BC+ is, and answering welding consent - never configuration. */
    private static readonly HARDCORE_ALLOWED = ["help", "version", "accept", "decline"];

    private dispatch(args: string[]): void {
        const sub = (args[0] ?? "help").toLocaleLowerCase();
        const command = this.commands.find((c) => c.name === sub);
        if (!command) {
            this.reply(`Unknown command "${escapeHtml(sub)}" - try /bcp help.`);
            return;
        }
        if (!TextCommands.HARDCORE_ALLOWED.includes(sub)
            && this.ModuleManager.getModule<Core>("core")?.hardcoreSelfBlocked() === true) {
            this.reply("Your hands are bound - BC+ commands are unavailable (hardcore).");
            return;
        }
        command.handler(args.slice(1));
    }

    /** DEV: /bcp test version [x.y.z|clear] - fake the latest release to test update UI. */
    private handleTest(args: string[]): void {
        const what = (args[0] ?? "").toLocaleLowerCase();
        if (what !== "version") {
            this.reply("Test helpers: /bcp test version [x.y.z|clear]");
            return;
        }
        const core = this.ModuleManager.getModule<Core>("core");
        if (!core) {
            return;
        }
        const value = (args[1] ?? "").toLocaleLowerCase();
        if (value === "clear") {
            core.devSetLatestVersion(null);
            this.reply("Latest-version override cleared - re-fetching the real manifest.");
            return;
        }
        let fake = value;
        if (fake === "") {
            // Default: one patch above the running build, so it always triggers
            const current = parseBCPVersion(BCPLUS_VERSION);
            if (!current) {
                return;
            }
            fake = `${current.major}.${current.minor}.${current.patch + 1}`;
        } else if (parseBCPVersion(fake) === null) {
            this.reply(`"${escapeHtml(fake)}" is not a valid version - use x.y.z or clear.`);
            return;
        }
        core.devSetLatestVersion(fake);
        this.reply(`Pretending v${escapeHtml(fake)} is the latest release - check the beep and the main menu. `
            + "Undo with /bcp test version clear.");
    }

    private showHelp(): void {
        this.reply([
            `${BCPLUS_APP_NAME} v${BCPLUS_VERSION} commands:`,
            ...this.commands.map((c) => `- /bcp ${c.name} - ${c.description}`),
        ].join("<br>"));
    }

    private reply(html: string): void {
        NotifyPlayer(html);
    }
}
