import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig, PermissionDefinition } from "@/system/module/ModuleTypes";
import { BCPLUS_AUTHOR, BCPLUS_VERSION } from "@/system/Constants";
import { Role } from "@/system/Roles";
import { COMMAND_DEFINITIONS, CommandDefinition } from "@/system/commands/CommandTypes";
import { CommandsScreen } from "@/gui/CommandsScreen";
import { GUIScreen } from "@/system/gui/GUIScreen";
import { BCPMessageContent, BCPNotifyPlayer, SendBCPMessage } from "@/utils/Messaging";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";
import type Authority from "@/modules/Authority";
import type Logging from "@/modules/Logging";

/** One-shot orders executed on the target's client after validation. */
export default class Commands extends ModuleInstance {

    protected readonly SystemConfig: ModuleConfig = {
        Name: "Commands",
        Version: BCPLUS_VERSION,
        Author: BCPLUS_AUTHOR,
        Description: "One-shot orders for other BC+ users",
        Active: true,
        Icon: "Icons/Activity.png",
        HoverText: "Commands are instant orders: poses, expressions, forced speech. "
            + "Who may command you is controlled by the commands.use permission.",
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
        return (character) => new CommandsScreen(this, character);
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
        this.addSyncListener("CommandInvoke", (sender, content) => this.onCommandInvoke(sender, content));
        this.addSyncListener("CommandInvokeResult", (sender, content) => {
            if (content.ok === false) {
                BCPNotifyPlayer(`${sender.Name} rejected the command${typeof content.reason === "string" ? `: ${content.reason}` : "."}`);
            }
        });
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
        const authority = this.ModuleManager.getModule<Authority>("authority");
        if (!authority?.hasPermission(senderNumber, "commands.use", definition.id)) {
            reject("no permission for this command");
            return;
        }
        const argument = typeof content.argument === "string"
            ? content.argument.slice(0, definition.argument?.maxChars ?? 0)
            : "";

        const result = definition.execute(argument, sender.Name);
        if (result !== true) {
            reject(result);
            return;
        }
        BCPNotifyPlayer(`${sender.Name} (#${senderNumber}) used the command "${definition.name}" on you.`);
        this.ModuleManager.getModule<Logging>("logging")
            ?.log("other", `${sender.Name} (#${senderNumber}) used the command "${definition.name}"`);
        SendBCPMessage({ message: "CommandInvokeResult", ok: true }, senderNumber);
    }
}
