import menuIcon from "@/assets/icons/commands.png";
import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig, PermissionDefinition } from "@/system/module/ModuleTypes";
import { BCPLUS_AUTHOR, BCPLUS_VERSION } from "@/system/Constants";
import { Role } from "@/system/Roles";
import { COMMAND_DEFINITIONS, CommandDefinition } from "@/system/commands/CommandTypes";
import { BindLineTaskStore, GetLineTask, LineTask, NormalizeLineText, SetLineTask } from "@/system/commands/LineTask";
import { err } from "@/system/Console";
import { AnySetting } from "@/system/gui/Settings";
import { BCPMessageContent, BCPNotifyPlayer, FindCharacterInRoom, SafeReasonSuffix, SendAction, SendBCPMessage } from "@/utils/Messaging";
import { WELD_WHISPER_COMMANDS } from "@/modules/Welding";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";
import type Authority from "@/modules/Authority";
import type Logging from "@/modules/Logging";
import type Core from "@/modules/Core";

/** One-shot orders executed on the target's client after validation. */
export default class Commands extends ModuleInstance {

    protected readonly SystemConfig: ModuleConfig = {
        Name: "Commands",
        Version: BCPLUS_VERSION,
        Author: BCPLUS_AUTHOR,
        Description: "One-shot orders for other BC+ users",
        Active: true,
        Icon: menuIcon,
        HoverText: "Commands are instant orders: poses, expressions, forced speech, movement, "
            + "lines and arousal. Who may command you is controlled by the commands.use "
            + "permission - those people can also whisper \"!bcp <command>\" to you.",
        PublicData: false,
        Reference: "commands",
        MenuString: "Commands",
    };

    override get Permissions(): PermissionDefinition[] {
        return [{
            id: "commands.use",
            label: "Give me commands",
            defaultRole: Role.Mistress,
            defaultSelf: true,
        }];
    }

    override get Settings(): AnySetting[] {
        return [{
            type: "checkbox",
            name: "whisperCommands",
            label: "Allow whisper commands (!bcp ...)",
            default: true,
        }];
    }

    override get Defaults(): Record<string, unknown> {
        return {
            ...super.Defaults,
            lineTask: null,
        };
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

    get Definitions(): readonly CommandDefinition[] {
        return COMMAND_DEFINITIONS;
    }

    canUseOnSelf(): boolean {
        const authority = this.ModuleManager.getModule<Authority>("authority");
        return authority?.hasPermission(Player.MemberNumber ?? -1, "commands.use") ?? false;
    }

    /** Executes locally (self-use) or sends the command to a remote target. */
    invoke(definition: CommandDefinition, argument: string, target: BCPlusCharacter | null): void {
        if (!target || target.isPlayer()) {
            if (!this.canUseOnSelf()) {
                BCPNotifyPlayer("You are not permitted to use commands on yourself.");
                return;
            }
            const result = definition.execute(argument, Player.Nickname || Player.Name);
            if (result !== true) {
                BCPNotifyPlayer(`Command failed: ${result}`);
            }
            return;
        }
        SendBCPMessage({
            message: "CommandInvoke",
            command: definition.id,
            argument,
        }, target.MemberNumber);
    }

    override Load(): void {
        // The static command definitions stay stateless - the lines task
        // lives in this module's save data so it survives reloads
        BindLineTaskStore({
            get: () => this.Data.lineTask as LineTask | null,
            set: (task) => { this.Data.lineTask = task; },
        });

        this.addSyncListener("CommandInvoke", (sender, content) => this.onCommandInvoke(sender, content));
        this.addSyncListener("CommandInvokeResult", (sender, content) => {
            if (content.ok === false) {
                BCPNotifyPlayer(`${sender.Name} rejected the command${SafeReasonSuffix(content.reason)}`);
            }
        });

        // Priority 10: above BCX's whisper-command hook (9), which swallows
        // every "!" whisper it does not know and replies "Unknown command";
        // below Welding's (11), which owns the weld whispers
        this.addHook("ChatRoomMessage", 10, (args, next) => {
            try {
                if (this.onWhisper(args[0] as ServerChatRoomMessage)) {
                    // Consumed: no display, and BCX never sees it
                    return;
                }
            } catch (e) {
                err("Whisper command handling failed:", e);
            }
            return next(args);
        });

        // Priority below the speech rules: transformed messages are counted
        // as sent, blocked ones never reach this hook
        this.addHook("ServerSend", 1, (args, next) => {
            const [message, data] = args as unknown as [string, { Type?: string; Content?: string }];
            if (message === "ChatRoomChat" && data?.Type === "Chat" && typeof data.Content === "string") {
                this.onLineTyped(data.Content);
            }
            return next(args);
        });
    }

    override Unload(): void {
        BindLineTaskStore(null);
        super.Unload();
    }

    /** Shared validation + execution for menu (CommandInvoke) and whisper commands. */
    private executeValidated(senderNumber: number, senderName: string, definition: CommandDefinition, rawArgument: string): true | string {
        const hardcore = this.ModuleManager.getModule<Core>("core")?.hardcoreSenderBlock(senderNumber);
        if (hardcore) {
            return hardcore;
        }
        const authority = this.ModuleManager.getModule<Authority>("authority");
        if (!authority?.hasPermission(senderNumber, "commands.use", definition.id)) {
            return "no permission for this command";
        }
        const argument = rawArgument.slice(0, definition.argument?.maxChars ?? 0);
        const result = definition.execute(argument, senderName);
        if (result !== true) {
            return result;
        }
        BCPNotifyPlayer(`${senderName} (#${senderNumber}) used the command "${definition.name}" on you.`);
        this.ModuleManager.getModule<Logging>("logging")
            ?.log("other", `${senderName} (#${senderNumber}) used the command "${definition.name}"`);
        return true;
    }

    private onCommandInvoke(sender: Character, content: BCPMessageContent): void {
        const senderNumber = sender.MemberNumber;
        if (typeof senderNumber !== "number") {
            return;
        }
        const reject = (reason: string): void => {
            SendBCPMessage({ message: "CommandInvokeResult", ok: false, reason }, senderNumber);
        };

        const definition = COMMAND_DEFINITIONS.find((d) => d.id === content.command);
        if (!definition) {
            reject("unknown command");
            return;
        }
        const argument = typeof content.argument === "string" ? content.argument : "";
        const result = this.executeValidated(senderNumber, sender.Name, definition, argument);
        if (result !== true) {
            reject(result);
            return;
        }
        SendBCPMessage({ message: "CommandInvokeResult", ok: true }, senderNumber);
    }

    /**
     * Whisper command interface: "!bcp <command> [text]" whispered by someone
     * with permission - works even when the sender does not run BC+. Replies
     * go back as targeted action messages (never garbled, and not blocked by
     * the player's own whisper rules).
     */
    private onWhisper(data: ServerChatRoomMessage): boolean {
        if (data.Type !== "Whisper" || typeof data.Content !== "string" || typeof data.Sender !== "number"
            || data.Sender === Player.MemberNumber || this.getSetting<boolean>("whisperCommands") !== true) {
            return false;
        }
        const senderNumber = data.Sender;
        // A gagged sender can wrap the command in OOC parentheses
        let text = data.Content.trim();
        if (text.startsWith("(")) {
            text = text.replace(/^\(+/, "").replace(/\)+$/, "").trim();
        }
        const match = /^!bcp\b\s*(\S*)\s*([\s\S]*)$/i.exec(text);
        if (!match) {
            return false;
        }
        const commandId = (match[1] ?? "").toLocaleLowerCase();
        const argument = (match[2] ?? "").trim();

        // Welding whispers are the Welding module's - it answers them itself
        // (and works even when this module or whisper commands are off)
        if (WELD_WHISPER_COMMANDS.includes(commandId)) {
            return false;
        }

        const sender = FindCharacterInRoom(senderNumber, { MemberNumber: true, Nickname: false, Name: false });
        if (!sender) {
            // Still a !bcp whisper - consume it so BCX does not error on it
            return true;
        }
        const reply = (message: string): void => SendAction(`BC+: ${message}`, sender);

        if (commandId === "" || commandId === "help" || commandId === "commands") {
            const authority = this.ModuleManager.getModule<Authority>("authority");
            const usable = this.Definitions.filter((d) => authority?.hasPermission(senderNumber, "commands.use", d.id));
            reply(usable.length === 0
                ? "You are not permitted to use any commands here."
                : `Commands you may whisper: ${usable.map((d) => `!bcp ${d.id}`).join(", ")}. Add any text after the command.`);
            return true;
        }
        const definition = this.Definitions.find((d) => d.id.toLocaleLowerCase() === commandId);
        if (!definition) {
            reply(`Unknown command "!bcp ${commandId}" - whisper "!bcp help" for the list.`);
            return true;
        }
        const result = this.executeValidated(senderNumber, sender.Name, definition, argument);
        reply(result === true ? `Command "${definition.name}" executed.` : `Command failed: ${result}`);
        return true;
    }

    /** Tracks "write lines" progress on the player's own sent chat messages. */
    private onLineTyped(content: string): void {
        const task = GetLineTask();
        if (!task || NormalizeLineText(content) !== NormalizeLineText(task.sentence)) {
            return;
        }
        const remaining = task.remaining - 1;
        if (remaining <= 0) {
            SetLineTask(null);
            SendAction(`${Player.Nickname || Player.Name} has finished writing lines.`);
            BCPNotifyPlayer(`Lines complete - "${task.sentence}" written ${task.total} time${task.total === 1 ? "" : "s"}.`);
            this.ModuleManager.getModule<Logging>("logging")
                ?.log("other", `Finished the ${task.total} lines assigned by ${task.assigner}`);
        } else {
            SetLineTask({ ...task, remaining });
            BCPNotifyPlayer(`Line accepted - ${remaining} of ${task.total} to go.`);
        }
    }
}
