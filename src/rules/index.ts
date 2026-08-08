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
    ForbidLeaving,
    GreetRoom,
    FarewellOnLeave,
];
