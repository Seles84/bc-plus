import { GetDotedPathType, PatchHook } from "bondage-club-mod-sdk";
import { ModuleConfig, PermissionDefinition } from "@/system/module/ModuleTypes";
import type { GUIScreen } from "@/system/gui/GUIScreen";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";
import { AnySetting, settingDefaults } from "@/system/gui/Settings";
import { AddSyncListener, BCPMessageContent, RemoveSyncListeners } from "@/utils/Messaging";
import type { BCPlus } from "@/index";
import type SDK from "@/system/SDK";
import type ModuleManager from "@/system/ModuleManager";
import type StorageManager from "@/system/StorageManager";
import type { EventBus } from "@/system/EventBus";

export abstract class ModuleInstance {

    protected abstract readonly SystemConfig: ModuleConfig;

    constructor(private readonly core: BCPlus) {}

    /**
     * Called once by the ModuleManager after login, before any module is loaded.
     * Override for async setup that must complete before Load (e.g. reading storage).
     */
    async Init(): Promise<void> {}

    /** Called by the ModuleManager once every module has been initialized. */
    Load(): void {}

    /** Removes everything this module changed in the game. */
    Unload(): void {
        this.removeHooks();
        RemoveSyncListeners(this.Slug);
    }

    Reload(): void {
        this.Unload();
        this.Load();
    }

    /** Settings shown on this module's auto-generated settings page. */
    get Settings(): AnySetting[] {
        return [];
    }

    /** Whether this module appears in the BC+ main menu. */
    get HasGUI(): boolean {
        return this.Settings.length > 0 || this.SettingsScreen !== null;
    }

    /**
     * Factory for this module's settings screen. Null uses the auto-generated
     * screen when `Settings` exist; override for a custom screen.
     */
    get SettingsScreen(): ((character: BCPlusCharacter | null) => GUIScreen) | null {
        return null;
    }

    /** Permissions this module exposes; collected into Authority at load. */
    get Permissions(): PermissionDefinition[] {
        return [];
    }

    /** Whether this module's screen can operate on another character remotely. */
    get SupportsRemote(): boolean {
        return false;
    }

    /**
     * Permission gating remote edits of this module's plain settings via
     * SettingCommand; null means the settings are never editable remotely.
     */
    get EditPermission(): string | null {
        return null;
    }

    /** Default data/settings for this module; saved values win over these. */
    get Defaults(): Record<string, unknown> {
        return settingDefaults(this.Settings);
    }

    getSetting<T>(name: string): T {
        return this.Data[name] as T;
    }

    setSetting(name: string, value: unknown): void {
        this.Data[name] = value;
    }

    /**
     * This module's persistent data slice. Mutations are saved automatically.
     * Available from Init() onwards (storage loads before modules).
     */
    get Data(): Record<string, unknown> {
        return this.core.Storage.getModuleData(this.Slug, this.Defaults);
    }

    get Config(): ModuleConfig {
        return this.SystemConfig;
    }

    get Slug(): string {
        return this.SystemConfig.Reference;
    }

    get Core(): BCPlus {
        return this.core;
    }

    get SDK(): SDK {
        return this.core.SDK;
    }

    get ModuleManager(): ModuleManager {
        return this.core.ModuleManager;
    }

    get Storage(): StorageManager {
        return this.core.Storage;
    }

    get Events(): EventBus {
        return this.core.Events;
    }

    get BCMode(): BCMode {
        return this.core.Mode;
    }

    /** The player's play preset (Dominant/Switch/Submissive/Slave). */
    get Preset(): string {
        const core = this.core.ModuleManager.getModule("core") as { getPreset?: () => string } | undefined;
        return core?.getPreset?.() ?? "Switch";
    }

    /** Hook a BC function; the hook is owned by this module and removed on Unload. */
    protected addHook<TFunctionName extends string>(
        functionName: TFunctionName,
        priority: number,
        hook: PatchHook<GetDotedPathType<typeof globalThis, TFunctionName>>,
    ): () => void {
        return this.SDK.addHook(this.Slug, functionName, priority, hook);
    }

    protected patchFunction(target: string, patches: Record<string, string>): void {
        this.SDK.patchFunction(target, patches);
    }

    /** Listens for an incoming BC+ message type; removed automatically on Unload. */
    protected addSyncListener(message: string, action: (sender: Character, content: BCPMessageContent) => void): void {
        AddSyncListener(this.Slug, message, action);
    }

    protected removeHooks(): void {
        this.SDK.removeHooks(this.Slug);
    }

    bcxInstalled(): boolean {
        return this.SDK.bcxInstalled();
    }
}
