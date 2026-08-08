import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig } from "@/system/module/ModuleTypes";
import { BCPLUS_AUTHOR, BCPLUS_VERSION } from "@/system/Constants";
import { debug } from "@/system/Console";
import {
    BCPMessageContent,
    BCPNotifyPlayer,
    DispatchBCPMessage,
    FindCharacterInRoom,
    GetBCPMessageFromChat,
    SendBCPMessage,
} from "@/utils/Messaging";
import type Authority from "@/modules/Authority";
import type Logging from "@/modules/Logging";
import { getChatroomCharacter } from "@/utils/BCPlusCharacter";
import { jsonClone } from "@/utils/BCUtils";

/**
 * Handles BC+-to-BC+ communication: presence/version handshake when
 * entering a room and public module data exchange over hidden messages.
 */
export default class DataSync extends ModuleInstance {

    protected readonly SystemConfig: ModuleConfig = {
        Name: "DataSync",
        Version: BCPLUS_VERSION,
        Author: BCPLUS_AUTHOR,
        Description: "Data syncing between BC+ users",
        Active: true,
        Icon: "",
        HoverText: "",
        PublicData: false,
        Reference: "data-sync",
    };

    /** JSON snapshots of each public module's data as last broadcast, keyed by slug. */
    private readonly lastBroadcast = new Map<string, string>();

    /** Shares the player's public module data (and BC+ version) with the room or one member. */
    settingSync(reply: boolean, target?: number): void {
        const settings = this.collectPublicData();
        if (target === undefined) {
            // Full room broadcast doubles as the change-detection baseline
            for (const [slug, data] of Object.entries(settings)) {
                this.lastBroadcast.set(slug, JSON.stringify(data));
            }
        }
        SendBCPMessage({
            message: "SettingSync",
            version: BCPLUS_VERSION,
            settings,
            reply,
        }, target);
    }

    /** Broadcasts any public module whose data changed since it was last shared. */
    private broadcastChangedCategories(): void {
        if (!ServerPlayerIsInChatRoom()) {
            return;
        }
        for (const module of this.ModuleManager.Modules) {
            if (!module.Config.PublicData || !module.Config.Active) {
                continue;
            }
            const snapshot = JSON.stringify(jsonClone(module.Data));
            if (this.lastBroadcast.get(module.Slug) !== snapshot) {
                this.lastBroadcast.set(module.Slug, snapshot);
                this.categorySync(module);
            }
        }
    }

    /** Shares one module's public data with the room or one member. */
    categorySync(module: ModuleInstance, target?: number): void {
        if (!module.Config.PublicData) {
            return;
        }
        SendBCPMessage({
            message: "CategorySync",
            version: BCPLUS_VERSION,
            category: module.Slug,
            value: jsonClone(module.Data),
        }, target);
    }

    override Load(): void {
        this.addSyncListener("SettingSync", (sender, content) => this.onSettingSync(sender, content));
        this.addSyncListener("CategorySync", (sender, content) => this.onCategorySync(sender, content));
        this.addSyncListener("SettingCommand", (sender, content) => this.onSettingCommand(sender, content));
        this.addSyncListener("SettingCommandResult", (sender, content) => {
            if (content.ok === false) {
                BCPNotifyPlayer(`${sender.Name} rejected the settings change${typeof content.reason === "string" ? `: ${content.reason}` : "."}`);
            }
        });

        // Receive hidden BC+ messages and dispatch them to listeners
        this.addHook("ChatRoomMessage", 0, (args, next) => {
            const data = args[0];
            const content = GetBCPMessageFromChat(data);
            if (!content) {
                return next(args);
            }
            const sender = FindCharacterInRoom(data.Sender ?? "", { MemberNumber: true, Name: false, Nickname: false });
            if (sender && sender.MemberNumber !== Player.MemberNumber) {
                debug(`Received BCP "${content.message}" from #${sender.MemberNumber}`);
                DispatchBCPMessage(sender, content);
            }
            // BC+ messages are consumed, not passed further down the chain
        });

        // Announce ourselves when joining a room. ChatRoomSync is async and
        // the client only counts as "in a room" partway through it - announce
        // after it completes (plus a grace delay), or the send is dropped.
        this.addHook("ChatRoomSync", 0, (args, next) => {
            const result = next(args);
            void Promise.resolve(result).then(() => {
                setTimeout(() => this.settingSync(true), 500);
            });
            return result;
        });

        // BC+ loaded while already in a room
        if (ChatRoomCharacter.length !== 0) {
            this.settingSync(true);
        }

        // Keep others' mirrors fresh: whenever the save persists, broadcast
        // any public module whose data changed (e.g. a role assignment made
        // after the join handshake).
        this.Events.on("saveSynced", () => this.broadcastChangedCategories());
    }

    private onSettingSync(sender: Character, content: BCPMessageContent): void {
        const character = typeof sender.MemberNumber === "number" ? getChatroomCharacter(sender.MemberNumber) : null;
        if (!character) {
            return;
        }
        character.BCPVersion = typeof content.version === "string" ? content.version : null;
        character.BCPData = this.asModuleData(content.settings);
        debug(`SettingSync from ${character.toString()} (BC+ v${character.BCPVersion})`);
        this.Events.emit("characterSyncReceived", { memberNumber: character.MemberNumber });

        if (content.reply === true) {
            this.settingSync(false, character.MemberNumber);
        }
    }

    private onCategorySync(sender: Character, content: BCPMessageContent): void {
        const character = typeof sender.MemberNumber === "number" ? getChatroomCharacter(sender.MemberNumber) : null;
        if (!character || typeof content.category !== "string") {
            return;
        }
        if (character.BCPData === null) {
            // We missed their full sync - ask for one
            this.settingSync(true, character.MemberNumber);
            return;
        }
        character.BCPData[content.category] = (content.value ?? {}) as Record<string, unknown>;
        this.Events.emit("characterSyncReceived", { memberNumber: character.MemberNumber });
    }

    /** Remote edit of a module's plain settings - validated here, target-authoritative. */
    private onSettingCommand(sender: Character, content: BCPMessageContent): void {
        const senderNumber = sender.MemberNumber;
        if (typeof senderNumber !== "number") {
            return;
        }
        const reject = (reason: string): void => {
            SendBCPMessage({ message: "SettingCommandResult", ok: false, reason }, senderNumber);
        };

        const { module: slug, name, value } = content;
        const module = typeof slug === "string" ? this.ModuleManager.getModule(slug) : undefined;
        const permission = module?.EditPermission;
        if (!module || !permission || !module.SupportsRemote) {
            reject("not editable");
            return;
        }
        const authority = this.ModuleManager.getModule<Authority>("authority");
        if (!authority?.hasPermission(senderNumber, permission)) {
            reject("no permission");
            return;
        }
        const setting = module.Settings.find((s) => s.name === name);
        const valid = setting !== undefined && (
            (setting.type === "checkbox" && typeof value === "boolean")
            || (setting.type === "option" && typeof value === "string" && setting.options.includes(value))
            || (setting.type === "text" && typeof value === "string" && value.length <= (setting.maxChars ?? 256))
        );
        if (!valid) {
            reject("invalid setting");
            return;
        }

        module.setSetting(setting.name, value);
        BCPNotifyPlayer(`${sender.Name} (#${senderNumber}) changed your ${module.Config.MenuString || module.Config.Name} setting "${setting.label}".`);
        this.ModuleManager.getModule<Logging>("logging")
            ?.log("authority", `${sender.Name} (#${senderNumber}) changed ${module.Config.Name} setting "${setting.label}"`);
        SendBCPMessage({ message: "SettingCommandResult", ok: true }, senderNumber);
    }

    private collectPublicData(): Record<string, Record<string, unknown>> {
        const result: Record<string, Record<string, unknown>> = {};
        for (const module of this.ModuleManager.Modules) {
            if (module.Config.PublicData && module.Config.Active) {
                result[module.Slug] = jsonClone(module.Data);
            }
        }
        return result;
    }

    private asModuleData(value: unknown): Record<string, Record<string, unknown>> {
        return (typeof value === "object" && value !== null) ? value as Record<string, Record<string, unknown>> : {};
    }
}
