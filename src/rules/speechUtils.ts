/** Splits a message into in-character and OOC (parenthesized) segments. */
export function splitSpeech(content: string): { text: string; ooc: boolean }[] {
    const ranges = [...SpeechGetOOCRanges(content)].sort((a, b) => a.start - b.start);
    const parts: { text: string; ooc: boolean }[] = [];
    let pos = 0;
    for (const range of ranges) {
        if (range.start > pos) {
            parts.push({ text: content.slice(pos, range.start), ooc: false });
        }
        parts.push({ text: content.slice(range.start, range.start + range.length), ooc: true });
        pos = range.start + range.length;
    }
    if (pos < content.length) {
        parts.push({ text: content.slice(pos), ooc: false });
    }
    return parts;
}

/** The in-character portion of a message. */
export function spokenText(content: string): string {
    return splitSpeech(content).filter((p) => !p.ooc).map((p) => p.text).join(" ").trim();
}

/** Applies a transform to the in-character segments only. */
export function transformSpoken(content: string, transform: (text: string) => string): string {
    return splitSpeech(content).map((p) => (p.ooc ? p.text : transform(p.text))).join("");
}

/** Parses a comma-separated, case-insensitive word/phrase list. */
export function parseWordList(raw: string): string[] {
    return raw
        .split(",")
        .map((w) => w.trim().toLocaleLowerCase())
        .filter((w) => w.length > 0);
}

export function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive word-boundary match. */
export function containsWord(text: string, word: string): boolean {
    return new RegExp(`(^|\\W)${escapeRegExp(word)}($|\\W)`, "i").test(text);
}

/** Words of a text, letters only (punctuation stripped per word). */
export function lettersOfWords(text: string): string[] {
    return text
        .split(/\s+/)
        .map((w) => w.replace(/[^\p{L}'-]/gu, ""))
        .filter((w) => w.length > 0);
}

/** Extracts an outgoing ChatRoomChat payload when it is a spoken message. */
export function spokenPayload(args: unknown[], types: string[] = ["Chat", "Whisper"]): { Type: string; Content: string } | null {
    const [event, data] = args as [string, { Type?: string; Content?: string }];
    if (event !== "ChatRoomChat" || typeof data?.Content !== "string" || !types.includes(data.Type ?? "")) {
        return null;
    }
    return data as { Type: string; Content: string };
}
