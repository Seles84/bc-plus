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
import type Core from "@/modules/Core";
import type Pet from "@/modules/Pet";
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

    /**
     * Synthetic public category "hardcore": the EFFECTIVE hardcore-others flag
     * (personal setting or the Hardcore Mode rule). Core's data is private, but
     * viewers need this one bit to gray out the BC+ button for bound people -
     * a courtesy mirror of the real target-side wall, never trusted for
     * enforcement.
     */
    private hardcoreCategory(): Record<string, unknown> {
        const core = this.ModuleManager.getModule<Core>("core");
        return { others: core?.getSetting<boolean>("hardcoreOthers") === true };
    }

    /**
     * Synthetic categories: public views computed from otherwise-private
     * module data ("hardcore" flag; the Pet module's coarse stat levels).
     * Compared and broadcast like regular categories.
     */
    private syntheticCategories(): Record<string, Record<string, unknown>> {
        const result: Record<string, Record<string, unknown>> = { hardcore: this.hardcoreCategory() };
        const pet = this.ModuleManager.getModule<Pet>("pet");
        if (pet) {
            // Included even while the module is off: the not-sharing tombstone
            // it returns then makes viewers drop stale ring levels
            result["pet"] = pet.publicPetData();
        }
        return result;
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
        for (const [category, value] of Object.entries(this.syntheticCategories())) {
            const snapshot = JSON.stringify(value);
            if (this.lastBroadcast.get(category) !== snapshot) {
                this.lastBroadcast.set(category, snapshot);
                SendBCPMessage({
                    message: "CategorySync",
                    version: BCPLUS_VERSION,
                    category,
                    value,
                });
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
        this.addSyncListener("SettingsRequest", (sender, content) => this.onSettingsRequest(sender, content));
        this.addSyncListener("SettingsResponse", (sender, content) => this.onSettingsResponse(sender, content));

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

        // The hardcore flag can flip without any data write (the Hardcore
        // Mode rule's conditions coming and going), so also compare on a slow
        // tick - it only sends when a snapshot actually changed
        this.freshnessTimer = setInterval(() => this.broadcastChangedCategories(), 10_000);
    }

    private freshnessTimer: ReturnType<typeof setInterval> | null = null;

    override Unload(): void {
        if (this.freshnessTimer !== null) {
            clearInterval(this.freshnessTimer);
            this.freshnessTimer = null;
        }
        super.Unload();
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

        const hardcore = this.ModuleManager.getModule<Core>("core")?.hardcoreSenderBlock(senderNumber);
        if (hardcore) {
            reject(hardcore);
            return;
        }
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
        // Public modules refresh mirrors via the change broadcast; private
        // ones push their fresh settings view to the editor directly
        if (!module.Config.PublicData) {
            this.sendSettingsView(module, senderNumber);
        }
    }

    /**
     * Asks another character for the current values of a private (non-public-
     * data) module's declared settings. The reply lands in their mirror.
     */
    requestModuleSettings(slug: string, target: number): void {
        SendBCPMessage({ message: "SettingsRequest", module: slug }, target);
    }

    /**
     * Settings of private modules are shared only with people permitted to
     * edit them (the module's EditPermission) - unlike public data, which
     * everyone in the room mirrors.
     */
    private onSettingsRequest(sender: Character, content: BCPMessageContent): void {
        const senderNumber = sender.MemberNumber;
        if (typeof senderNumber !== "number") {
            return;
        }
        const module = typeof content.module === "string" ? this.ModuleManager.getModule(content.module) : undefined;
        const permission = module?.EditPermission;
        if (!module || !permission || !module.SupportsRemote || module.Config.PublicData) {
            return;
        }
        const authority = this.ModuleManager.getModule<Authority>("authority");
        if (!authority?.hasPermission(senderNumber, permission)) {
            debug(`Settings request for ${module.Slug} from #${senderNumber}: denied`);
            return;
        }
        this.sendSettingsView(module, senderNumber);
    }

    /** Sends the declared-settings values of a module to one member. */
    private sendSettingsView(module: ModuleInstance, target: number): void {
        SendBCPMessage({
            message: "SettingsResponse",
            module: module.Slug,
            values: Object.fromEntries(module.Settings.map((s) => [s.name, jsonClone(module.getSetting(s.name))])),
        }, target);
    }

    /** A requested private-module settings view arrived - store it in the mirror. */
    private onSettingsResponse(sender: Character, content: BCPMessageContent): void {
        const character = typeof sender.MemberNumber === "number" ? getChatroomCharacter(sender.MemberNumber) : null;
        if (!character || typeof content.module !== "string"
            || typeof content.values !== "object" || content.values === null) {
            return;
        }
        character.BCPData ??= {};
        character.BCPData[content.module] = {
            ...character.BCPData[content.module],
            ...(content.values as Record<string, unknown>),
        };
        debug(`Settings view for ${content.module} received from ${character.toString()}`);
        this.Events.emit("characterSyncReceived", { memberNumber: character.MemberNumber });
    }

    private collectPublicData(): Record<string, Record<string, unknown>> {
        const result: Record<string, Record<string, unknown>> = {};
        for (const module of this.ModuleManager.Modules) {
            if (module.Config.PublicData && module.Config.Active) {
                result[module.Slug] = jsonClone(module.Data);
            }
        }
        Object.assign(result, this.syntheticCategories());
        return result;
    }

    private asModuleData(value: unknown): Record<string, Record<string, unknown>> {
        return (typeof value === "object" && value !== null) ? value as Record<string, Record<string, unknown>> : {};
    }
}
