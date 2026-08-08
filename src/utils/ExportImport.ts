import { BCPNotifyPlayer } from "@/utils/Messaging";

const CODE_PREFIX = "BCP1";
const MAX_CODE_LENGTH = 30_000;

/** Encodes a payload as a shareable `BCP1:<type>:<data>` code. */
export function encodeExport(type: string, payload: unknown): string {
    return `${CODE_PREFIX}:${type}:${LZString.compressToBase64(JSON.stringify(payload))}`;
}

/** Decodes a `BCP1:` code; null when malformed or not of the expected type. */
export function decodeExport(code: string, expectedType: string): unknown | null {
    const trimmed = code.trim();
    if (trimmed.length > MAX_CODE_LENGTH) {
        return null;
    }
    const match = new RegExp(`^${CODE_PREFIX}:([a-z]+):([A-Za-z0-9+/=]+)$`).exec(trimmed);
    if (!match || match[1] !== expectedType) {
        return null;
    }
    try {
        const json = LZString.decompressFromBase64(match[2]!);
        return json ? JSON.parse(json) as unknown : null;
    } catch {
        return null;
    }
}

/** Copies a code to the clipboard, falling back to a copyable prompt. */
export function copyExportCode(code: string): void {
    const clipboard = navigator.clipboard;
    if (clipboard?.writeText) {
        clipboard.writeText(code).then(
            () => BCPNotifyPlayer("Export code copied to clipboard."),
            () => window.prompt("Copy the export code:", code),
        );
    } else {
        window.prompt("Copy the export code:", code);
    }
}

/** Asks the player to paste a code; null when cancelled/empty. */
export function promptImportCode(): string | null {
    const code = window.prompt("Paste a BC+ code:");
    return code && code.trim().length > 0 ? code.trim() : null;
}
