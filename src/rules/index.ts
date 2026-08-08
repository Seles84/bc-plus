import { RuleDefinition } from "@/system/rules/RuleTypes";
import { ForbidWhisper } from "@/rules/ForbidWhisper";
import { ForbidOOC } from "@/rules/ForbidOOC";
import { ForbidBeepMessages } from "@/rules/ForbidBeepMessages";
import { ForbiddenWords } from "@/rules/ForbiddenWords";
import { ForbidEmotes } from "@/rules/ForbidEmotes";
import { ForbidShouting } from "@/rules/ForbidShouting";
import { ForbidLeaving } from "@/rules/ForbidLeaving";

/** Every rule BC+ ships, in display order. */
export const RULE_DEFINITIONS: readonly RuleDefinition[] = [
    ForbidWhisper,
    ForbidOOC,
    ForbiddenWords,
    ForbidShouting,
    ForbidEmotes,
    ForbidBeepMessages,
    ForbidLeaving,
];
