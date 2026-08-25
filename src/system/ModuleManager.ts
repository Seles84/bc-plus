import { ModuleInstance } from "@/system/module/ModuleInstance";
import { debug, err } from "@/system/Console";
import type { BCPlus } from "@/index";
import Authority from "@/modules/Authority";
import Commands from "@/modules/Commands";
import Contracts from "@/modules/Contracts";
import Core from "@/modules/Core";
import Curses from "@/modules/Curses";
import DataSync from "@/modules/DataSync";
import Logging from "@/modules/Logging";
import Pet from "@/modules/Pet";
import Punishments from "@/modules/Punishments";
import Relationships from "@/modules/Relationships";
import Roles from "@/modules/Roles";
import Rules from "@/modules/Rules";
import Statistics from "@/modules/Statistics";
import TextCommands from "@/modules/TextCommands";
import Welding from "@/modules/Welding";
import { GUI } from "@/modules/GUI";

export default class ModuleManager {

    private readonly modules: ModuleInstance[];
    private loaded = false;

    constructor(private readonly parent: BCPlus) {
        this.modules = [
            new DataSync(parent),
            new Roles(parent),
            new Authority(parent),
            new Rules(parent),
            new Curses(parent),
            new Punishments(parent),
            new Contracts(parent),
            new Commands(parent),
            new Relationships(parent),
            new Pet(parent),
            new Welding(parent),
            new Statistics(parent),
            new Logging(parent),
            new TextCommands(parent),
            new GUI(parent),
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

        // Collect permission definitions before any module loads
        const authority = this.getModule<Authority>("authority");
        if (authority) {
            for (const module of active) {
                authority.registerPermissions(module.Permissions);
            }
        }

        // Feature modules the player switched off stay initialized (their
        // permissions remain configurable) but never load their hooks
        const core = this.getModule<Core>("core");
        for (const module of active) {
            if (module.CanDisable && core && !core.isModuleEnabled(module.Slug)) {
                module.Config.Active = false;
                debug(`Module disabled by player config: ${module.Config.Name}`);
                continue;
            }
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
