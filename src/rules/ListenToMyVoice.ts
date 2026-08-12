import { RuleDefinition } from "@/system/rules/RuleTypes";
import { stringListValue } from "@/system/gui/Settings";

/**
 * Periodically shows one of the configured sentences to the player,
 * as a voice in their head. Only they can see it, and only in a room.
 */
export const ListenToMyVoice: RuleDefinition = {
    id: "other.listenToMyVoice",
    name: "Listen to my voice",
    description: "One of the configured sentences appears to the player at random, at the set "
        + "interval, while they are in a chat room. Only they can see it.",
    category: "Other",
    bcxEquivalent: "other_constant_reminder",
    settings: [
        {
            type: "stringList",
            name: "sentences",
            label: "Sentences:",
            default: [],
            entryLabel: "sentence",
            maxChars: 200,
            legacySeparator: "|",
        },
        {
            type: "option",
            name: "frequency",
            label: "Minutes between sentences",
            options: ["2", "5", "10", "15", "30"],
            default: "15",
        },
    ],
    load(ctx) {
        let lastShown = Date.now();
        ctx.interval(() => {
            if (!ctx.inEffect() || !ServerPlayerIsInChatRoom()) {
                return;
            }
            const sentences = stringListValue(ctx.setting<unknown>("sentences"), "|");
            const frequencyMs = Number.parseInt(ctx.setting<string>("frequency"), 10) * 60_000;
            if (sentences.length === 0 || Date.now() < lastShown + frequencyMs) {
                return;
            }
            lastShown = Date.now();
            const sentence = sentences[Math.floor(Math.random() * sentences.length)]!;
            ChatRoomSendLocal(
                `<p style='color:#a67fd4;font-style:italic;margin-bottom:0.25em;margin-top:0'>[Voice] ${sentence.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`,
            );
        }, 15_000);
    },
};
