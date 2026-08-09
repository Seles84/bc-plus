import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig } from "@/system/module/ModuleTypes";
import { BCPLUS_APP_NAME, BCPLUS_AUTHOR, BCPLUS_VERSION } from "@/system/Constants";
import { LOG_MAX_ENTRIES, formatLogTime } from "@/system/logging/LogTypes";
import { ListSyncListeners, NotifyPlayer } from "@/utils/Messaging";
import { getAllCharactersInRoom } from "@/utils/BCPlusCharacter";
import type Rules from "@/modules/Rules";
import type Curses from "@/modules/Curses";
import type Logging from "@/modules/Logging";
import type DataSync from "@/modules/DataSync";

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
            name: "sync",
            description: "Re-announce BC+ and sync data with the room",
            handler: () => {
                this.ModuleManager.getModule<DataSync>("data-sync")?.settingSync(true);
                this.reply("Sync sent to the room.");
            },
        },
        {
            name: "reset",
            description: "Factory reset: wipe ALL BC+ data (rules, curses, roles, permissions, log)",
            handler: () => {
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

    private dispatch(args: string[]): void {
        const sub = (args[0] ?? "help").toLocaleLowerCase();
        const command = this.commands.find((c) => c.name === sub);
        if (!command) {
            this.reply(`Unknown command "${escapeHtml(sub)}" - try /bcp help.`);
            return;
        }
        command.handler(args.slice(1));
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
