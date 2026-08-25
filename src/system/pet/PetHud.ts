import { PET_STATS, clampLevel } from "@/system/pet/PetTypes";

export interface PetRingEntry {
    label: string;
    color: string;
    /** 0-100 */
    level: number;
}

/**
 * Builds ring entries from a broadcast pet mirror's `levels` record (untrusted
 * remote data - values are validated and clamped). Empty when nothing usable.
 */
export function ringEntriesFromMirror(mirror: unknown): PetRingEntry[] {
    if (!mirror || typeof mirror !== "object") {
        return [];
    }
    const levels = (mirror as Record<string, unknown>)["levels"];
    if (!levels || typeof levels !== "object") {
        return [];
    }
    const entries: PetRingEntry[] = [];
    for (const stat of PET_STATS) {
        const value = (levels as Record<string, unknown>)[stat.id];
        if (typeof value === "number" && Number.isFinite(value)) {
            entries.push({ label: stat.label, color: stat.color, level: clampLevel(value) });
        }
    }
    return entries;
}

/**
 * Draws a row of pet stat rings at a character's feet (MPA-style), with a
 * hover tooltip per ring. `raise` moves the row up a little for clients that
 * also run MPA, whose HUD occupies the same spot.
 */
export function drawPetRings(
    entries: PetRingEntry[],
    CharX: number, CharY: number, Zoom: number,
    options: { raise?: boolean; showNumbers?: boolean } = {},
): void {
    if (entries.length === 0) {
        return;
    }
    const radius = 16 * Zoom;
    const spacing = 40 * Zoom;
    const y = CharY + (options.raise ? 900 : 950) * Zoom;
    const startX = CharX + 250 * Zoom - ((entries.length - 1) * spacing) / 2;

    let hovered: { x: number; label: string; percent: number } | null = null;
    entries.forEach((entry, i) => {
        const x = startX + i * spacing;
        drawStatRing(x, y, radius, entry.level / 100, entry.color);
        if (options.showNumbers) {
            const prevAlign = MainCanvas.textAlign;
            MainCanvas.textAlign = "center";
            DrawTextFit(String(Math.round(entry.level)), x, y, radius * 1.5, "White", "Black");
            MainCanvas.textAlign = prevAlign;
        }
        if (MouseIn(x - radius, y - radius, radius * 2, radius * 2)) {
            hovered = { x, label: entry.label, percent: Math.round(entry.level) };
        }
    });

    // Tooltip after all rings, so it overlays its neighbors
    if (hovered !== null) {
        const tip = hovered as { x: number; label: string; percent: number };
        const prevAlign = MainCanvas.textAlign;
        MainCanvas.textAlign = "center";
        DrawRect(tip.x - 110, y - radius - 54, 220, 44, "rgba(0, 0, 0, 0.75)");
        DrawTextFit(`${tip.label}: ${tip.percent}%`, tip.x, y - radius - 32, 210, "White");
        MainCanvas.textAlign = prevAlign;
    }
}

/** A ring outline with a pie fill for the current fraction. */
function drawStatRing(x: number, y: number, radius: number, fraction: number, color: string): void {
    MainCanvas.save();
    // Soft light halo so the saturated rings read on dark backdrops too
    MainCanvas.beginPath();
    MainCanvas.arc(x, y, radius, 0, Math.PI * 2);
    MainCanvas.fillStyle = "rgba(255, 255, 255, 0.35)";
    MainCanvas.fill();
    MainCanvas.lineWidth = Math.max(1.5, radius / 8);
    MainCanvas.strokeStyle = color;
    MainCanvas.stroke();
    if (fraction > 0) {
        MainCanvas.beginPath();
        MainCanvas.moveTo(x, y);
        MainCanvas.arc(x, y, radius * 0.8, -Math.PI / 2, -Math.PI / 2 - Math.PI * 2 * Math.min(1, fraction), true);
        MainCanvas.closePath();
        MainCanvas.fillStyle = color;
        MainCanvas.fill();
    }
    MainCanvas.restore();
}
