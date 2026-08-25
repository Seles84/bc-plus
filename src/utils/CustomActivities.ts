/**
 * Minimal custom-activity support: registers extra activities in BC's tables
 * so they appear on the activity wheel like native ones. Effects ride the
 * normal activity chat message (server echo), so registrants listen on
 * ChatRoomMessage rather than passing trigger callbacks here.
 *
 * The owning module must install three hooks wired to a registry instance:
 * ActivityCheckPrerequisite -> handlePrerequisite, ServerSend (ChatRoomChat/
 * Activity) -> appendFallbackText, ElementButton.CreateForActivity -> imageFor.
 */

/** Prefix of every BC+ custom activity name. */
export const BCP_ACTIVITY_PREFIX = "BCP_";

export interface CustomActivityDef {
    /** Full activity name, must start with BCP_ */
    name: string;
    /** Button label */
    label: string;
    /** Self-target groups the activity appears on */
    selfGroups: AssetGroupItemName[];
    /** Room text when used on yourself (SourceCharacter/Pronoun tags allowed) */
    actionSelf: string;
    /** Button image path or data URI */
    image: string;
    maxProgress?: number;
    /** Vanilla prerequisite names */
    prerequisites?: string[];
    /** One custom prerequisite, evaluated through the ActivityCheckPrerequisite hook */
    customPrerequisite?: { name: string; check: (acting: Character) => boolean };
}

export class CustomActivityRegistry {

    private readonly registered: CustomActivityDef[] = [];
    private readonly prerequisiteChecks = new Map<string, (acting: Character) => boolean>();
    private readonly images = new Map<string, string>();
    private readonly dictionaryKeys: string[] = [];

    register(defs: CustomActivityDef[]): void {
        for (const def of defs) {
            this.registerOne(def);
        }
    }

    private registerOne(def: CustomActivityDef): void {
        const cache = ActivityDictionaryLoad().cache;
        const nextId = Math.max(0, ...ActivityFemale3DCG.map((a) => a.ActivityID ?? 0)) + 1;
        const prerequisites = [...(def.prerequisites ?? [])];
        if (def.customPrerequisite) {
            prerequisites.push(def.customPrerequisite.name);
            this.prerequisiteChecks.set(def.customPrerequisite.name, def.customPrerequisite.check);
        }
        const activity = {
            Name: def.name,
            ActivityID: nextId,
            MaxProgress: def.maxProgress ?? 50,
            Prerequisite: prerequisites,
            Target: [],
            TargetSelf: [...def.selfGroups],
        } as unknown as Activity;

        const addText = (key: string, text: string): void => {
            cache[key] = text;
            this.dictionaryKeys.push(key);
        };
        addText(`Activity${def.name}`, def.label);
        for (const group of def.selfGroups) {
            addText(`Label-ChatSelf-${group}-${def.name}`, def.label);
            addText(`ChatSelf-${group}-${def.name}`, def.actionSelf);
        }

        this.images.set(def.name, def.image);
        ActivityFemale3DCG.push(activity);
        ActivityFemale3DCGOrdering.push(activity.Name);
        this.registered.push(def);
    }

    /** Removes every registered activity from BC's tables again. */
    unregisterAll(): void {
        const cache = ActivityDictionaryLoad().cache;
        for (const def of this.registered.splice(0)) {
            const index = ActivityFemale3DCG.findIndex((a) => (a.Name as string) === def.name);
            if (index !== -1) {
                ActivityFemale3DCG.splice(index, 1);
            }
            const orderIndex = ActivityFemale3DCGOrdering.indexOf(def.name as ActivityName);
            if (orderIndex !== -1) {
                ActivityFemale3DCGOrdering.splice(orderIndex, 1);
            }
        }
        for (const key of this.dictionaryKeys.splice(0)) {
            delete cache[key];
        }
        this.prerequisiteChecks.clear();
        this.images.clear();
    }

    /** Custom prerequisite result, or null when the name is not one of ours. */
    handlePrerequisite(name: string, acting: Character): boolean | null {
        const check = this.prerequisiteChecks.get(name);
        return check ? check(acting) : null;
    }

    imageFor(activityName: string): string | undefined {
        return this.images.get(activityName);
    }

    /**
     * Appends the rendered text as a missing-text fallback entry to an
     * outgoing activity message, so clients without BC+ still see a proper
     * line instead of a raw dictionary key.
     */
    appendFallbackText(data: { Content?: string; Dictionary?: unknown[] }): void {
        if (typeof data.Content !== "string" || !Array.isArray(data.Dictionary)) {
            return;
        }
        data.Dictionary.push({
            Tag: `MISSING TEXT IN "ActivityDictionary.csv": ${data.Content}`,
            Text: ActivityDictionaryText(data.Content),
        });
    }
}
