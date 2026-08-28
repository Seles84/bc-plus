import { BCPNotifyPlayer } from "@/utils/Messaging";
import { modalPrompt } from "@/gui/Modal";

const CODE_PREFIX = "BCP1";
const MAX_CODE_LENGTH = 30_000;
/**
 * Cap on the DECOMPRESSED payload: LZ codes expand super-linearly, so a
 * 30KB code crafted as a decompression bomb could otherwise freeze the tab
 * inside JSON.parse. Far above any legitimate export.
 */
const MAX_DECOMPRESSED_LENGTH = 2_000_000;

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
        if (!json || json.length > MAX_DECOMPRESSED_LENGTH) {
            return null;
        }
        return JSON.parse(json) as unknown;
    } catch {
        return null;
    }
}

/** Copies a code to the clipboard, falling back to a copyable modal. */
export function copyExportCode(code: string): void {
    // decodeExport rejects oversized codes - handing out one nobody can
    // import would be a silent trap
    if (code.length > MAX_CODE_LENGTH) {
        BCPNotifyPlayer("This export is too large to be imported - trim some data (e.g. export categories separately) and try again.");
        return;
    }
    const clipboard = navigator.clipboard;
    if (clipboard?.writeText) {
        clipboard.writeText(code).then(
            () => BCPNotifyPlayer("Export code copied to clipboard."),
            () => void modalPrompt("Copy the export code:", code, 40_000),
        );
    } else {
        void modalPrompt("Copy the export code:", code, 40_000);
    }
}

/** Asks the player to paste a code; null when cancelled/empty. */
export async function promptImportCode(): Promise<string | null> {
    const code = await modalPrompt("Paste a BC+ code:", "", 40_000);
    return code && code.trim().length > 0 ? code.trim() : null;
}
