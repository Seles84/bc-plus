import { RuleDefinition } from "@/system/rules/RuleTypes";
import { ForbidWhisper } from "@/rules/ForbidWhisper";
import { ForbidOOC } from "@/rules/ForbidOOC";
import { ForbidBeepMessages } from "@/rules/ForbidBeepMessages";
import { ForbiddenWords } from "@/rules/ForbiddenWords";
import { ForbidEmotes } from "@/rules/ForbidEmotes";
import { ForbidShouting } from "@/rules/ForbidShouting";
import { ForbidLeaving } from "@/rules/ForbidLeaving";
import { DollTalk } from "@/rules/DollTalk";
import { WordReplace } from "@/rules/WordReplace";
import { MandatoryWords } from "@/rules/MandatoryWords";
import { RestrainedSpeech } from "@/rules/RestrainedSpeech";
import { FalteringSpeech } from "@/rules/FalteringSpeech";
import { GaggedOOC } from "@/rules/GaggedOOC";
import { GreetRoom } from "@/rules/GreetRoom";
import { FarewellOnLeave } from "@/rules/FarewellOnLeave";
import { ListenToMyVoice } from "@/rules/ListenToMyVoice";
import { ReadyToBeSummoned } from "@/rules/ReadyToBeSummoned";
import {
    ForbidBreakingUp,
    ForbidDisowning,
    ForbidNewLovers,
    ForbidNewSubmissives,
    ForbidOwnerChanges,
    PreventBlacklisting,
    PreventWhitelisting,
} from "@/rules/ProtectionRules";
import {
    ForbidFreeingOthers,
    ForbidFreeingSelf,
    ForbidTyingOthers,
    ForbidTyingSelf,
    ForbidWardrobeOthers,
    ForbidWardrobeSelf,
} from "@/rules/BondageRules";
import {
    ForbidKeysOthers,
    ForbidKeysSelf,
    ForbidLockOthers,
    ForbidLockSelf,
    ForbidPickOthers,
    ForbidPickSelf,
    ForbidRemotesOthers,
    ForbidRemotesSelf,
} from "@/rules/LocksRules";
import {
    ForbidCreatingRooms,
    ForbidRoomAdminUI,
    RestrictRoomEntry,
} from "@/rules/RoomRules";
import {
    HearingWhitelist,
    SeeingWhitelist,
    SensoryDepSight,
    SensoryDepSound,
} from "@/rules/SensoryRules";
import {
    ControlOrgasms,
    ForbidPoseChanges,
    ForbiddenPoses,
    ForceKneeling,
    ForcedPosition,
    SecretOrgasms,
} from "@/rules/BodyRules";
import {
    ControlNickname,
    ForbidActivities,
    ForbidDifficultyChange,
    ForbidEmoticonChange,
    LockProfileDescription,
    RestrictLeashing,
} from "@/rules/ControlRules";
import { ForbidBeeps, ForbidFriendListChanges } from "@/rules/SocialRules";
import { ForcedAfkBehavior } from "@/rules/ForcedAfk";
import { SETTING_RULES } from "@/rules/SettingRules";

/** Every rule BC+ ships, in display order. */
export const RULE_DEFINITIONS: readonly RuleDefinition[] = [
    ForbidWhisper,
    ForbidOOC,
    GaggedOOC,
    ForbiddenWords,
    MandatoryWords,
    RestrainedSpeech,
    DollTalk,
    WordReplace,
    FalteringSpeech,
    ForbidShouting,
    ForbidEmotes,
    ForbidBeepMessages,
    ForbidBeeps,
    ForbidFriendListChanges,
    ForbidLeaving,
    ForbidCreatingRooms,
    RestrictRoomEntry,
    ForbidRoomAdminUI,
    GreetRoom,
    FarewellOnLeave,
    ListenToMyVoice,
    ReadyToBeSummoned,
    ForbidOwnerChanges,
    ForbidNewLovers,
    ForbidBreakingUp,
    ForbidNewSubmissives,
    ForbidDisowning,
    PreventBlacklisting,
    PreventWhitelisting,
    ForbidTyingSelf,
    ForbidTyingOthers,
    ForbidFreeingSelf,
    ForbidFreeingOthers,
    ForbidWardrobeSelf,
    ForbidWardrobeOthers,
    ForbidRemotesSelf,
    ForbidRemotesOthers,
    ForbidKeysSelf,
    ForbidKeysOthers,
    ForbidPickSelf,
    ForbidPickOthers,
    ForbidLockSelf,
    ForbidLockOthers,
    SensoryDepSound,
    HearingWhitelist,
    SensoryDepSight,
    SeeingWhitelist,
    ForbidPoseChanges,
    ForbiddenPoses,
    ForceKneeling,
    ForcedPosition,
    ForcedAfkBehavior,
    ControlOrgasms,
    SecretOrgasms,
    ForbidDifficultyChange,
    ForbidActivities,
    ForbidEmoticonChange,
    RestrictLeashing,
    ControlNickname,
    LockProfileDescription,
    ...SETTING_RULES,
];
