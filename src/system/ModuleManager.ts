import { ModuleInstance } from "@/system/module/ModuleInstance";
import { debug, err } from "@/system/Console";
import type { BCPlus } from "@/index";
import Core from "@/modules/Core";

export default class ModuleManager {

    private readonly modules: ModuleInstance[];
    private loaded = false;

    constructor(private readonly parent: BCPlus) {
        this.modules = [
            new Core(parent),
        ];
    }

    /** Initializes and loads every active module. Called once after login. */
    async load(): Promise<void> {
        if (this.loaded) {
            return;
        }
        this.loaded = true;

        const active = this.modules.filter((m) => m.Config.Active);

        for (const module of active) {
            try {
                await module.Init();
                debug(`Initialized module: ${module.Config.Name} v${module.Config.Version}`);
            } catch (e) {
                err(`Failed to initialize module ${module.Config.Name}:`, e);
            }
        }

        for (const module of active) {
            try {
                module.Load();
                this.parent.Events.emit("moduleLoaded", { slug: module.Slug });
                debug(`Loaded module: ${module.Config.Name}`);
            } catch (e) {
                err(`Failed to load module ${module.Config.Name}:`, e);
            }
        }

        this.parent.Events.emit("modulesLoaded", undefined);
    }

    unload(): void {
        this.modules.forEach((module) => {
            module.Unload();
            this.parent.Events.emit("moduleUnloaded", { slug: module.Slug });
        });
        this.loaded = false;
    }

    get Modules(): readonly ModuleInstance[] {
        return this.modules;
    }

    getModule<T extends ModuleInstance = ModuleInstance>(slug: string): T | undefined {
        return this.modules.find((module) => module.Slug === slug) as T | undefined;
    }
}
