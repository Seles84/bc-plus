import { RuleDefinition } from "@/system/rules/RuleTypes";
import { spokenPayload } from "@/rules/speechUtils";

/** Blocks OOC text while the player is unable to talk (gagged). */
export const GaggedOOC: RuleDefinition = {
    id: "speech.gaggedOOC",
    name: "Block OOC while gagged",
    description: "The player cannot use out-of-character (parenthesized) text while gagged - "
        + "a gag should not be so easy to talk around.",
    category: "Speech",
    announceAttempt: "{Name} mumbles into the gag, unable to slip out of character.",
    load(ctx) {
        ctx.hook("ServerSend", 5, (args, next) => {
            const data = spokenPayload(args as unknown[]);
            if (!data || Player.CanTalk() || SpeechGetOOCRanges(data.Content).length === 0) {
                return next(args);
            }
            if (ctx.isEnforced()) {
                ctx.triggerAttempt();
                ctx.notify("A rule blocks OOC while you are gagged.");
                return;
            }
            ctx.trigger();
            return next(args);
        });
    },
};
