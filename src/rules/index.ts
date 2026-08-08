import { RuleDefinition } from "@/system/rules/RuleTypes";
import { ForbidWhisper } from "@/rules/ForbidWhisper";
import { ForbidOOC } from "@/rules/ForbidOOC";
import { ForbidBeepMessages } from "@/rules/ForbidBeepMessages";

/** Every rule BC+ ships, in display order. */
export const RULE_DEFINITIONS: readonly RuleDefinition[] = [
    ForbidWhisper,
    ForbidOOC,
    ForbidBeepMessages,
];
