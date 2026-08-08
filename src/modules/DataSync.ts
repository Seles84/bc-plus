import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig } from "@/system/module/ModuleTypes";
import { BCPLUS_AUTHOR, BCPLUS_VERSION } from "@/system/Constants";
import { debug } from "@/system/Console";
import {
    BCPMessageContent,
    DispatchBCPMessage,
    FindCharacterInRoom,
    GetBCPMessageFromChat,
    SendBCPMessage,
} from "@/utils/Messaging";
import { getChatroomCharacter } from "@/utils/BCPlusCharacter";

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

    /** Shares the player's public module data (and BC+ version) with the room or one member. */
    settingSync(reply: boolean, target?: number): void {
        SendBCPMessage({
            message: "SettingSync",
            version: BCPLUS_VERSION,
            settings: this.collectPublicData(),
            reply,
        }, target);
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
            value: structuredClone(module.Data),
        }, target);
    }

    override Load(): void {
        this.addSyncListener("SettingSync", (sender, content) => this.onSettingSync(sender, content));
        this.addSyncListener("CategorySync", (sender, content) => this.onCategorySync(sender, content));

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

    private collectPublicData(): Record<string, Record<string, unknown>> {
        const result: Record<string, Record<string, unknown>> = {};
        for (const module of this.ModuleManager.Modules) {
            if (module.Config.PublicData && module.Config.Active) {
                result[module.Slug] = structuredClone(module.Data);
            }
        }
        return result;
    }

    private asModuleData(value: unknown): Record<string, Record<string, unknown>> {
        return (typeof value === "object" && value !== null) ? value as Record<string, Record<string, unknown>> : {};
    }
}
