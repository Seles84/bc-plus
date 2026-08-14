import { RuleContext, RuleDefinition } from "@/system/rules/RuleTypes";
import { stringListValue } from "@/system/gui/Settings";

/** Every pose the self pose menu can offer, for validating configured names. */
const ALL_POSE_NAMES: readonly string[] = [
    "BaseUpper", "BackBoxTie", "BackCuffs", "BackElbowTouch", "OverTheHead", "Yoked",
    "BaseLower", "Kneel", "KneelingSpread", "LegsClosed", "Spread",
    "Hogtied", "AllFours", "Suspension", "TapedHands",
];

type PoseClickStatus = (C: Character, pose: Pose) => string | null;

/** Registers a status callback on the self pose menu; removed when the rule deactivates. */
function addPoseClickStatus(ctx: RuleContext, key: string, callback: PoseClickStatus): void {
    // Same extensible-record situation as the item grid callbacks
    const callbacks = DialogSelfMenuMapping.Pose.clickStatusCallbacks as unknown as Record<string, PoseClickStatus>;
    callbacks[key] = callback;
    ctx.cleanup(() => {
        delete callbacks[key];
    });
}

/** Case-insensitive match of a configured pose list against a pose name. */
function poseListed(ctx: RuleContext, settingName: string, poseName: string): boolean {
    return stringListValue(ctx.setting<unknown>(settingName))
        .some((entry) => entry.trim().toLocaleLowerCase() === poseName.toLocaleLowerCase());
}

/** Shared plumbing: block/observe unaided self pose changes matching `applies`. */
function poseBlockRule(
    id: string,
    name: string,
    description: string,
    settings: RuleDefinition["settings"],
    applies: (ctx: RuleContext, poseName: string) => boolean,
): RuleDefinition {
    return {
        id,
        name,
        description,
        category: "Body",
        bcxEquivalent: "block_restrict_allowed_poses",
        announceAttempt: "{Name} tried to change into a pose a rule forbids.",
        announceViolation: "{Name} changed into a pose a rule forbids.",
        settings,
        load(ctx) {
            addPoseClickStatus(ctx, `BCPlus_${id}`, (C, pose) =>
                ctx.isEnforced() && C.IsPlayer() && applies(ctx, pose.Name)
                    ? `Blocked by BC+ rule: "${name}"`
                    : null);
            // The unaided-status clamp catches every non-menu path too (e.g.
            // chat commands and other mods going through the pose framework)
            ctx.hook("PoseCanChangeUnaidedStatus", 0, (args, next) => {
                const status = next(args) as PoseChangeStatus;
                const [C, poseName] = args as unknown as [Character, string];
                if (ctx.isEnforced() && C?.IsPlayer() && applies(ctx, poseName)) {
                    return Math.min(status, PoseChangeStatus.NEVER_WITHOUT_AID) as PoseChangeStatus;
                }
                return status;
            });
            ctx.hook("DialogSelfMenuMapping.Pose._ClickButton", 0, (args, next) => {
                const C = args[1] as Character;
                const pose = args[2] as Pose;
                if (ctx.inEffect() && !ctx.isEnforced() && C.IsPlayer() && applies(ctx, pose.Name)) {
                    ctx.trigger();
                }
                return next(args);
            });
            ctx.hook("DialogSelfMenuMapping.Pose.eventListeners._ClickDisabledButton", 0, (args, next) => {
                // Hooks do not forward `this` (the button), but the event's
                // currentTarget is that same button
                const menu = DialogSelfMenuMapping.Pose as unknown as {
                    C: Character | null;
                    _GetClickedObject(button: HTMLButtonElement): Pose | null;
                };
                const button = (args[0] as MouseEvent | undefined)?.currentTarget;
                const pose = button instanceof HTMLButtonElement ? menu._GetClickedObject(button) : null;
                if (ctx.isEnforced() && menu.C?.IsPlayer() && pose && applies(ctx, pose.Name)) {
                    ctx.triggerAttempt();
                }
                return next(args);
            });
        },
    };
}

/** The player cannot change their own pose at all. */
export const ForbidPoseChanges = poseBlockRule(
    "body.forbidPoses",
    "Forbid changing poses",
    "The player cannot change their own body pose unaided - kneeling, standing up, "
        + "spreading and every other pose stays as it is. Others (and items) can still pose them.",
    undefined,
    () => true,
);

/** Specific poses from a configured list are off-limits. */
export const ForbiddenPoses = poseBlockRule(
    "body.forbiddenPoses",
    "Forbid specific poses",
    "The player cannot change into the listed poses by themselves. Pose names: "
        + `${ALL_POSE_NAMES.join(", ")}.`,
    [{
        type: "stringList",
        name: "poses",
        label: "Forbidden poses:",
        default: [],
        entryLabel: "pose name",
        maxChars: 30,
    }],
    (ctx, poseName) => poseListed(ctx, "poses", poseName),
);

const KNEEL_CHECK_MS = 4000;

/** Forced to kneel: standing poses are blocked and standing up is corrected. */
export const ForceKneeling: RuleDefinition = {
    id: "body.forceKneel",
    name: "Forced to kneel",
    description: "The player must stay on their knees: choosing a standing lower-body pose is "
        + "blocked, and if they end up standing they are put back down. Poses that need aid "
        + "(restraints forcing them upright) are left alone rather than fought.",
    category: "Body",
    announceViolation: "{Name} is put back down onto her knees.",
    load(ctx) {
        const standing = (poseName: string): boolean =>
            ["BaseLower", "LegsClosed", "Spread"].includes(poseName);
        addPoseClickStatus(ctx, "BCPlus_body.forceKneel", (C, pose) =>
            ctx.isEnforced() && C.IsPlayer() && standing(pose.Name)
                ? 'Blocked by BC+ rule: "Forced to kneel"'
                : null);
        ctx.hook("PoseCanChangeUnaidedStatus", 0, (args, next) => {
            const status = next(args) as PoseChangeStatus;
            const [C, poseName] = args as unknown as [Character, string];
            if (ctx.isEnforced() && C?.IsPlayer() && standing(poseName)) {
                return Math.min(status, PoseChangeStatus.NEVER_WITHOUT_AID) as PoseChangeStatus;
            }
            return status;
        });
        ctx.interval(() => {
            if (!ctx.isEnforced() || typeof Player === "undefined" || !Player.MemberNumber
                || !ServerIsConnected || Player.IsKneeling()) {
                return;
            }
            // Only correct what the player could correct themselves - a pose
            // held by restraints/items is not theirs to change (or ours)
            if (!PoseCanChangeUnaided(Player, "Kneel")) {
                return;
            }
            PoseSetActive(Player, "Kneel", true);
            if (ServerPlayerIsInChatRoom()) {
                ChatRoomCharacterUpdate(Player);
            }
            ctx.trigger();
            ctx.notify("A rule forces you back onto your knees.");
        }, KNEEL_CHECK_MS);
    },
};

/** Orgasm control: edge, ruin, or no resisting - mirrors BCX's approach. */
export const ControlOrgasms: RuleDefinition = {
    id: "body.controlOrgasms",
    name: "Control orgasms",
    description: "Controls what happens when the player's arousal peaks, independent of items: "
        + "Edge keeps the meter just below the top so the orgasm never starts; Ruin starts the "
        + "orgasm screen but denies the actual climax; No resisting removes the option to fight "
        + "an orgasm off. Requires the arousal meter to be enabled.",
    category: "Body",
    bcxEquivalent: "alt_control_orgasms",
    settings: [{
        type: "option",
        name: "mode",
        label: "Orgasm attempts are:",
        default: "Edged",
        options: ["Edged", "Ruined", "Unresistable"],
    }],
    load(ctx) {
        // Outgoing activity messages claim the matching outcome, so the room
        // sees a coherent story (same normalization BCX applies)
        ctx.hook("ServerSend", 2, (args, next) => {
            const [event, data] = args as unknown as [string, { Type?: string; Content?: string }];
            if (event === "ChatRoomChat" && data?.Type === "Activity" && typeof data.Content === "string" && ctx.isEnforced()) {
                if (data.Content.startsWith("OrgasmFailPassive")) {
                    data.Content = "OrgasmFailPassive0";
                } else if (data.Content.startsWith("OrgasmFailTimeout")) {
                    data.Content = "OrgasmFailTimeout2";
                } else if (data.Content.startsWith("OrgasmFailResist")) {
                    data.Content = "OrgasmFailResist2";
                } else if (data.Content.startsWith("OrgasmFailSurrender")) {
                    data.Content = "OrgasmFailSurrender2";
                }
            }
            return next(args);
        });
        ctx.hook("ActivityOrgasmPrepare", 5, (args, next) => {
            const C = args[0] as Character;
            if (!ctx.isEnforced() || !C.IsPlayer()) {
                return next(args);
            }
            const mode = ctx.setting<string>("mode");
            if (mode === "Edged") {
                if (C.ArousalSettings) {
                    C.ArousalSettings.Progress = 95;
                }
                return;
            }
            if (mode === "Ruined") {
                const backup = Player.Effect;
                Player.Effect = backup.concat("DenialMode", "RuinOrgasms");
                const result = next(args);
                Player.Effect = backup;
                return result;
            }
            // Unresistable: the resist minigame becomes unwinnable
            ActivityOrgasmGameResistCount = 496.5;
            return next(args);
        });
    },
};

/** The player cannot see their own arousal meter. */
export const SecretOrgasms: RuleDefinition = {
    id: "body.secretOrgasms",
    name: "Secret arousal meter",
    description: "The player cannot see their own arousal meter even while it is active - the "
        + "orgasm quick-time event comes as a surprise. Whether others can see the meter is "
        + "unchanged (that stays a BC setting).",
    category: "Body",
    bcxEquivalent: "alt_secret_orgasms",
    load(ctx) {
        ctx.hook("DrawArousalMeter", 5, (args, next) => {
            const C = args[0] as Character;
            if (C.ID === 0 && ctx.isEnforced()) {
                return;
            }
            return next(args);
        });
        // Also swallow the click that would zoom the (hidden) own meter
        ctx.hook("ChatRoomCharacterViewClickCharacter", 5, (args, next) => {
            const [C, CharX, CharY, Zoom] = args as unknown as [Character, number, number, number];
            if (C.ID === 0 && ctx.isEnforced()) {
                if (!C.ArousalZoom && MouseIn(CharX + 60 * Zoom, CharY + 400 * Zoom, 80 * Zoom, 100 * Zoom)) {
                    return;
                }
                if (C.ArousalZoom && MouseIn(CharX + 50 * Zoom, CharY + 200 * Zoom, 100 * Zoom, 500 * Zoom)) {
                    return;
                }
            }
            return next(args);
        });
    },
};
