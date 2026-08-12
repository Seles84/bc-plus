import { RuleDefinition } from "@/system/rules/RuleTypes";
import { stringListValue } from "@/system/gui/Settings";
import { escapeRegExp, spokenPayload, transformSpoken } from "@/rules/speechUtils";

function parseReplacements(entries: string[]): [string, string][] {
    return entries
        .map((pair) => pair.split(":").map((s) => s.trim()))
        .filter((parts): parts is [string, string] => parts.length === 2 && parts[0]!.length > 0)
        .map((parts) => [parts[0].toLocaleLowerCase(), parts[1]] as [string, string]);
}

/** Replaces configured words in spoken text (e.g. "i:this doll"). OOC text is exempt. */
export const WordReplace: RuleDefinition = {
    id: "speech.wordReplace",
    name: "Replace spoken words",
    description: "Configured words are replaced in everything the player says. "
        + "Each entry is word:replacement (e.g. \"i:this doll\"). "
        + "Out-of-character text is not affected.",
    category: "Speech",
    bcxEquivalent: "speech_replace_spoken_words",
    settings: [{
        type: "stringList",
        name: "replacements",
        label: "Replacements:",
        default: [],
        entryLabel: "word:replacement",
        maxChars: 120,
    }],
    load(ctx) {
        ctx.hook("ServerSend", 4, (args, next) => {
            const data = spokenPayload(args as unknown[]);
            if (!data || !ctx.isEnforced()) {
                return next(args);
            }
            const replacements = parseReplacements(stringListValue(ctx.setting<unknown>("replacements")));
            if (replacements.length === 0) {
                return next(args);
            }
            data.Content = transformSpoken(data.Content, (text) => {
                let result = text;
                for (const [word, replacement] of replacements) {
                    result = result.replace(new RegExp(`(^|\\W)${escapeRegExp(word)}($|\\W)`, "gi"), `$1${replacement}$2`);
                }
                return result;
            });
            return next(args);
        });
    },
};
