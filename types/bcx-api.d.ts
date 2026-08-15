/**
 * Type declarations for the public BCX API exposed on `window.bcx`.
 * Based on BCX's published API surface; BC+ only depends on the generic parts
 * (no full BCX rule declarations), so rule ids are plain strings here.
 */

interface BCXVersion {
    major: number;
    minor: number;
    patch: number;
    extra?: string;
    dev?: boolean;
}

type BCX_Rule = string;

interface BCX_RuleStateAPI {
    /** The name of the rule */
    readonly rule: BCX_Rule;
    /** Definition of the rule */
    readonly ruleDefinition: unknown;

    /** Current condition data of the rule */
    readonly condition: unknown;

    /** If the rule is in effect (active and all conditions valid) */
    readonly inEffect: boolean;
    /** If the rule is enforced (inEffect and enforce enabled) */
    readonly isEnforced: boolean;
    /** If the rule is logged (inEffect and logging enabled) */
    readonly isLogged: boolean;

    /** Rule settings */
    readonly customData: unknown;
    /** Rule internal data */
    readonly internalData: unknown;

    /**
     * Triggers and logs that Player violated this rule
     * @param targetCharacter - If the rule is against specific target different than player, this adds it to log
     * @param dictionary - Dictionary of rule-specific text replacements in logs and notifications
     */
    trigger(targetCharacter?: number | null, dictionary?: Record<string, string>): void;

    /**
     * Triggers and logs that Player attempted to violate this rule, but the attempt was blocked
     * @param targetCharacter - If the rule is against specific target different than player, this adds it to log
     * @param dictionary - Dictionary of rule-specific text replacements in logs and notifications
     */
    triggerAttempt(targetCharacter?: number | null, dictionary?: Record<string, string>): void;
}

interface BCX_Events {
    curseTrigger: {
        /** Which action the curses did to the item */
        action: "remove" | "add" | "swap" | "update" | "color" | "autoremove";
        /** Name of asset group that was changed */
        group: string;
    };
    ruleTrigger: {
        /** The rule that was triggered */
        rule: BCX_Rule;
        /** `trigger` = the action happened; `triggerAttempt` = the action was blocked */
        triggerType: "trigger" | "triggerAttempt";
        /** Character that was being targeted (most rules do not use this) */
        targetCharacter: number | null;
    };
    bcxSubscreenChange: {
        /** Whether BCX is currently showing one of its custom screens */
        inBcxSubscreen: boolean;
    };
    bcxLocalMessage: {
        /** The actual message that is to be displayed */
        message: string | Node;
        /** If set, the message auto-hides after this many milliseconds */
        timeout?: number;
        /** Sender metadata (used for displaying a membernumber on some messages) */
        sender?: number;
    };
}

type BCXEvent = Record<never, unknown>;
type BCXAnyEvent<T extends BCXEvent> = {
    [key in keyof T]: {
        event: key;
        data: T[key];
    };
}[keyof T];

interface BCXEventEmitter<T extends BCXEvent> {
    on<K extends keyof T>(s: K, listener: (v: T[K]) => void): () => void;
    onAny(listener: (value: BCXAnyEvent<T>) => void): () => void;
}

interface BCX_CurseInfo {
    /** Whether the curse is active or disabled */
    readonly active: boolean;
    /** The group this info is for */
    readonly group: AssetGroupName;
    /** BC asset the curse keeps, or `null` if the group is cursed to be empty */
    readonly asset: Asset | null;
    /** What color the item is cursed with */
    readonly color?: ItemColor;
    /** Whether properties are cursed (if set, `property` is enforced, otherwise only applied on item re-apply) */
    readonly curseProperty: boolean;
    /** The properties that are enforced */
    readonly property?: ItemProperties;
}

interface BCX_ModAPI extends BCXEventEmitter<BCX_Events> {
    /** Name of the mod this API was requested for */
    readonly modName: string;

    /** Returns state handler for a rule or `null` for unknown rule */
    getRuleState(rule: BCX_Rule): BCX_RuleStateAPI | null;

    /** Returns info about how a slot is cursed */
    getCurseInfo(group: AssetGroupName): BCX_CurseInfo | null;
}

interface BCX_ConsoleInterface {
    /** Version of loaded BCX */
    readonly version: string;

    /** Version parsed to components */
    readonly versionParsed: Readonly<BCXVersion>;

    /**
     * Gets BCX version of another character in room
     * @param target - The membernumber of character to get; undefined = Player
     */
    getCharacterVersion(target?: number): string | null;

    /** Gets if BCX runs in development mode */
    readonly isDevel: boolean;

    /**
     * Get access to BCX Mod API.
     * @param mod - Same identifier of your mod as used for ModSDK
     */
    getModApi(mod: string): BCX_ModAPI;

    /** Whether BCX is currently showing one of its custom screens */
    inBcxSubscreen(): boolean;
}

interface Window {
    bcx?: BCX_ConsoleInterface;
}
