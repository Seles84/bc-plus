import { AUTH_STRING_SIZE, SAVE_FILE_VERSION, SaveFile, StorageType, defaultSaveFile } from "@/system/storage/SaveFile";
import { BCPLUS_STORAGE } from "@/system/Constants";
import { debug, err, info, log } from "@/system/Console";
import { modalConfirm, modalInfo, modalPrompt } from "@/gui/Modal";
import { hmacSHA256 } from "@/utils/Crypto";

export type VerifyResponse = "Success" | "Failed" | "Unofficial";

const SYNC_DEBOUNCE_MS = 250;

/**
 * Owns the BC+ save file. Loaded once after login (before any module),
 * then kept in sync automatically: all reads/writes go through a deep Proxy
 * and any mutation schedules a debounced save.
 *
 * Save format (compatible with the original design):
 * `<format-version>:<lzstring-base64 json>:<hmac16 | "-">`
 * The HMAC marks saves written by official builds; builds without a
 * `BCP_SAVE_KEY` write `-` and skip verification.
 */
export default class StorageManager {

    private saveFile: SaveFile | null = null;
    private proxiedSaveFile: SaveFile | null = null;
    private readonly proxyCache = new WeakMap<object, object>();
    private storageLocation: StorageType = StorageType.ExtensionSettings;
    private isApplying = false;
    private syncTimer: ReturnType<typeof setTimeout> | null = null;
    /** After a wipe, nothing may write again until reload - a pending debounced sync would resurrect the data. */
    private wiped = false;

    /** Invoked after every successful persist (used to broadcast public data changes). */
    onAfterSync: (() => void) | null = null;

    /** The live save file. All mutations are persisted automatically. */
    get Data(): SaveFile {
        if (!this.proxiedSaveFile) {
            throw new Error("Save file not loaded");
        }
        return this.proxiedSaveFile;
    }

    get Location(): StorageType {
        return this.storageLocation;
    }

    /**
     * Returns a module's data slice, creating it from `defaults` when absent.
     * Saved values win over defaults; new default keys are added.
     */
    getModuleData(slug: string, defaults: Record<string, unknown> = {}): Record<string, unknown> {
        const modules = this.Data.modules;
        if (modules[slug] === undefined) {
            modules[slug] = { ...defaults };
        } else {
            for (const [key, value] of Object.entries(defaults)) {
                if (!(key in modules[slug])) {
                    modules[slug][key] = value;
                }
            }
        }
        return modules[slug];
    }

    /**
     * Locates and loads the save data.
     * @returns false when loading failed and the user declined a reset (boot should abort)
     */
    async init(): Promise<boolean> {
        debug("Loading storage...");

        let saved: string | null = localStorage.getItem(this.getLocalStorageName(false));
        if (typeof saved === "string") {
            info("Storage location: LocalStorage");
            this.storageLocation = StorageType.LocalStorage;
        } else {
            if (typeof Player.ExtensionSettings !== "object" || Player.ExtensionSettings === null) {
                err("Player.ExtensionSettings could not be found, please report this to the developer.");
                await modalInfo("Failed to load data, please see the console for more details.");
                return false;
            }
            const fromServer: unknown = Player.ExtensionSettings[BCPLUS_STORAGE];
            saved = typeof fromServer === "string" ? fromServer : null;
            this.storageLocation = StorageType.ExtensionSettings;
        }

        if (saved === null) {
            const backup = localStorage.getItem(this.getLocalStorageName(true));
            if (typeof backup === "string" && await modalConfirm("A backup of your data was found, would you like to use it?")) {
                saved = backup;
                this.storageLocation = StorageType.LocalStorage;
            }
        }

        if (saved === null) {
            log("First time init");
            await this.firstBoot();
            return true;
        }

        try {
            const verdict = await this.verifySaveFile(saved);
            if (verdict === "Unofficial" && !await modalConfirm(
                "You are using an unofficial version of BC+.\n"
                + "If you continue, you will not be able to return to the official version without resetting your data.\n"
                + "Are you sure you want to continue?",
            )) {
                return false;
            }
            this.load(saved, verdict);
            return true;
        } catch (e) {
            err("Failed to load save data:", e);
            if (await modalConfirm(`Failed to load save data...\n${String(e)}\nContinue with a full reset?`, true)) {
                this.clear();
                await this.firstBoot();
                return true;
            }
            return false;
        }
    }

    async verifySaveFile(save: string): Promise<VerifyResponse> {
        const parts = save.split(":");
        if (parts.length !== 3 || parts[0] !== SAVE_FILE_VERSION.toString()) {
            throw new Error("Invalid save file version");
        }
        const [, data, hmac] = parts;

        // Builds without a save key cannot verify - accept anything readable
        if (BCP_SAVE_KEY === "") {
            return "Success";
        }
        if (hmac === "-") {
            return "Unofficial";
        }
        if (hmac === undefined || data === undefined || hmac.length !== AUTH_STRING_SIZE) {
            return "Failed";
        }
        const calculated = await hmacSHA256(data, BCP_SAVE_KEY, AUTH_STRING_SIZE);
        return calculated === hmac ? "Success" : "Failed";
    }

    /** Persists the current save file to the active storage location (plus backup). */
    async sync(): Promise<void> {
        if (this.wiped) {
            return;
        }
        if (!this.saveFile) {
            throw new Error("Save file not loaded");
        }
        const data = this.serialize(this.saveFile);

        // Round-trip sanity check before overwriting good data
        const reparsed = this.deserialize(data);
        if (JSON.stringify(reparsed) !== JSON.stringify(this.saveFile)) {
            err("Save file round-trip mismatch, refusing to save", { reparsed, saveFile: this.saveFile });
            throw new Error("Save file round-trip mismatch");
        }
        if (data.includes(":")) {
            throw new Error("Serialized data contains forbidden characters");
        }

        const auth = BCP_SAVE_KEY === "" ? "-" : await hmacSHA256(data, BCP_SAVE_KEY, AUTH_STRING_SIZE);
        const finalSave = `${SAVE_FILE_VERSION}:${data}:${auth}`;

        if (this.storageLocation === StorageType.LocalStorage) {
            localStorage.setItem(this.getLocalStorageName(false), finalSave);
            debug("Saved to local storage");
        } else {
            Player.ExtensionSettings[BCPLUS_STORAGE] = finalSave;
            ServerPlayerExtensionSettingsSync(BCPLUS_STORAGE, true);
            debug("Saved to extension settings");
        }
        localStorage.setItem(this.getLocalStorageName(true), finalSave);
        this.onAfterSync?.();
    }

    switchStorage(storage: StorageType): void {
        if (storage === this.storageLocation) {
            return;
        }
        info(`Switching storage location to ${StorageType[storage]}`);
        this.clear();
        this.storageLocation = storage;
        void this.safeSync();
    }

    /** Wipes all BC+ data everywhere; returns whether the wipe happened. */
    async wipeAllData(ask: boolean = true): Promise<boolean> {
        if (ask) {
            const answer = await modalPrompt(
                "Are you sure you want to wipe all BC+ data?\nThis cannot be undone!\nEnter your member number to confirm:",
            );
            if (answer !== Player.MemberNumber?.toString()) {
                return false;
            }
        }
        this.clear();
        this.wiped = true;
        return true;
    }

    getLocalStorageName(backup: boolean): string {
        return backup
            ? `${BCPLUS_STORAGE}_${Player.MemberNumber}_Backup`
            : `${BCPLUS_STORAGE}_${Player.MemberNumber}`;
    }

    private load(save: string, verdict: VerifyResponse): void {
        if (verdict === "Failed") {
            throw new Error("Save verification failed");
        }
        const parts = save.split(":");
        const parsed = this.deserialize(parts[1]!);
        if (typeof parsed !== "object" || parsed === null || typeof parsed.version !== "string") {
            throw new Error("Invalid save file contents");
        }
        parsed.modules ??= {};

        this.isApplying = true;
        try {
            this.setSaveFile(parsed);
        } finally {
            this.isApplying = false;
        }
        debug(`Save file loaded (written by v${parsed.version})`);
    }

    private async firstBoot(): Promise<void> {
        this.storageLocation = StorageType.ExtensionSettings;
        this.setSaveFile(defaultSaveFile());
        await this.sync();
    }

    private clear(): void {
        localStorage.removeItem(this.getLocalStorageName(false));
        localStorage.removeItem(this.getLocalStorageName(true));
        // BC's sync only accepts a string or null here - null is the deletion
        // sentinel; a deleted (undefined) key makes ServerPlayerExtensionSettingsSync throw
        if (Player.ExtensionSettings[BCPLUS_STORAGE] != null) {
            Player.ExtensionSettings[BCPLUS_STORAGE] = null;
            ServerPlayerExtensionSettingsSync(BCPLUS_STORAGE, true);
        }
    }

    private serialize(data: SaveFile): string {
        const compressed = LZString.compressToBase64(JSON.stringify(data));
        if (!compressed) {
            throw new Error("Failed to serialize save file");
        }
        return compressed;
    }

    private deserialize(data: string): SaveFile {
        const json = LZString.decompressFromBase64(data);
        if (!json) {
            throw new Error("Corrupt save data");
        }
        return JSON.parse(json) as SaveFile;
    }

    private scheduleSync(): void {
        if (this.syncTimer !== null) {
            clearTimeout(this.syncTimer);
        }
        this.syncTimer = setTimeout(() => {
            this.syncTimer = null;
            void this.safeSync();
        }, SYNC_DEBOUNCE_MS);
    }

    private async safeSync(): Promise<void> {
        if (this.isApplying || !this.saveFile) {
            return;
        }
        try {
            await this.sync();
        } catch (e) {
            err("Auto-sync failed", e);
        }
    }

    private makeAutoSyncProxy<T extends object>(obj: T): T {
        const cached = this.proxyCache.get(obj);
        if (cached) {
            return cached as T;
        }

        const handler: ProxyHandler<T> = {
            get: (target, prop, receiver) => {
                const value: unknown = Reflect.get(target, prop, receiver);
                return (value && typeof value === "object")
                    ? this.makeAutoSyncProxy(value)
                    : value;
            },
            set: (target, prop, value, receiver) => {
                const ok = Reflect.set(target, prop, value, receiver);
                this.scheduleSync();
                return ok;
            },
            deleteProperty: (target, prop) => {
                const ok = Reflect.deleteProperty(target, prop);
                this.scheduleSync();
                return ok;
            },
            defineProperty: (target, prop, descriptor) => {
                const ok = Reflect.defineProperty(target, prop, descriptor);
                this.scheduleSync();
                return ok;
            },
        };

        const proxied = new Proxy(obj, handler);
        this.proxyCache.set(obj, proxied);
        return proxied;
    }

    private setSaveFile(data: SaveFile): void {
        this.saveFile = data;
        this.proxiedSaveFile = this.makeAutoSyncProxy(this.saveFile);
    }
}
