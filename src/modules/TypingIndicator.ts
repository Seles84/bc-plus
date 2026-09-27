import menuIcon from "@/assets/icons/typing.png";
import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig } from "@/system/module/ModuleTypes";
import { BCPLUS_AUTHOR, BCPLUS_VERSION } from "@/system/Constants";
import { debug } from "@/system/Console";
import type { AnySetting } from "@/system/gui/Settings";

type StatusType = "Typing" | "Whisper" | "Emote" | "None";

/** No input for this long counts as "stopped typing" (matches BCX's feel). */
const IDLE_TIMEOUT_MS = 3000;

/**
 * Typing indicator, speaking BCX's wire protocol for full interop: a hidden
 * "BCXMsg" chat message with a ChatRoomStatusEvent payload. BCX renders
 * these from ANY sender (verified in their dispatch - no BCX-presence
 * gate), so BCX users see BC+ users typing and vice versa. BC's own coarse
 * "Talk" status keeps flowing for plain-BC viewers; the vanilla feet-dots
 * are suppressed only for characters we already draw a bubble for.
 *
 * In tandem mode this module stands down completely - BCX owns the feature
 * (every path checks live, so a late-loading BCX takes over cleanly).
 */
export default class TypingIndicator extends ModuleInstance {

    /** Statuses received from others, keyed by member number. */
    private readonly received = new Map<number, { type: StatusType; at: number }>();

    private ownStatus: StatusType = "None";
    private ownTarget: number | null = null;

    private trackedInput: HTMLTextAreaElement | null = null;
    private readonly onInputBound = (): void => this.onInput();
    private readonly onBlurBound = (): void => this.inputEnd();
    private attachTimer: ReturnType<typeof setInterval> | null = null;
    private idleTimer: ReturnType<typeof setTimeout> | null = null;

    protected readonly SystemConfig: ModuleConfig = {
        Name: "TypingIndicator",
        Version: BCPLUS_VERSION,
        Author: BCPLUS_AUTHOR,
        Description: "Speech-bubble typing indicators, compatible with BCX's",
        Active: true,
        Icon: menuIcon,
        HoverText: "Shows a speech bubble over people who are typing (faded while they "
            + "whisper, marked for emotes) and broadcasts your own typing the same way. "
            + "Fully compatible with BCX users - you see them, they see you. With BCX "
            + "running alongside BC+, BCX handles this and these settings do nothing.",
        PublicData: false,
        Reference: "typing",
        MenuString: "Typing indicator",
    };

    override get CanDisable(): boolean {
        return true;
    }

    override get Settings(): AnySetting[] {
        return [
            {
                type: "checkbox",
                name: "broadcast",
                label: "Broadcast my typing status",
                hoverText: "Others with BC+ or BCX see a bubble while you type. Plain BC's "
                    + "own coarse status is unaffected by this switch.",
                default: true,
                onSet: () => {
                    if (this.getSetting<boolean>("broadcast") !== true) {
                        this.inputEnd();
                    }
                },
            },
            {
                type: "checkbox",
                name: "showOthers",
                label: "Show a bubble over people who are typing",
                default: true,
            },
        ];
    }

    /** BCX owns the whole feature while it runs - every path stands down live. */
    private standDown(): boolean {
        return window.bcx !== undefined;
    }

    override Load(): void {
        // The chat input is a DOM element BC rebuilds with the room UI -
        // cheap re-attach sweep instead of chasing every rebuild path
        this.attachTimer = setInterval(() => {
            this.ensureInputTracked();
            this.pruneToRoster();
        }, 1000);

        this.addHook("ChatRoomMessage", 8, (args, next) => {
            const data = args[0] as {
                Type?: string; Content?: string; Sender?: number;
                Dictionary?: { type?: string; message?: { Type?: string; Target?: number | null } };
            } | undefined;
            if (typeof data?.Sender === "number" && data.Sender !== Player.MemberNumber) {
                if (data.Type === "Hidden" && data.Content === "BCXMsg"
                    && data.Dictionary?.type === "ChatRoomStatusEvent"
                    && typeof data.Dictionary.message?.Type === "string") {
                    const { Type, Target } = data.Dictionary.message;
                    const forUs = Target == null || Target === Player.MemberNumber;
                    if (!forUs || Type === "None" || !["Typing", "Whisper", "Emote"].includes(Type)) {
                        this.received.delete(data.Sender);
                    } else {
                        this.received.set(data.Sender, { type: Type as StatusType, at: Date.now() });
                    }
                } else if (data.Type === "Chat" || data.Type === "Whisper" || data.Type === "Emote") {
                    // A real message ends the typing - robust even when a
                    // sender's None update got lost
                    this.received.delete(data.Sender);
                }
            }
            return next(args);
        });

        // Bubble at the head, same spot and alphas as BCX uses
        this.addHook("ChatRoomCharacterViewDrawOverlay", 1, (args, next) => {
            const result = next(args);
            if (this.standDown() || this.getSetting<boolean>("showOthers") !== true
                || ChatRoomHideIconState >= 2) {
                return result;
            }
            const [C, CharX, CharY, Zoom] = args as [Character, number, number, number];
            const status = this.statusOf(C);
            if (status !== "None") {
                this.drawBubble(CharX + 375 * Zoom, CharY + 54 * Zoom, 50 * Zoom, 48 * Zoom, status);
            }
            return result;
        });

        // No doubled indicators: vanilla's feet-dots stay for plain-BC
        // characters, but are skipped for anyone we bubble
        this.addHook("DrawStatus", 1, (args, next) => {
            if (!this.standDown() && this.getSetting<boolean>("showOthers") === true
                && this.statusOf(args[0] as Character) !== "None") {
                return;
            }
            return next(args);
        });
    }

    override Unload(): void {
        if (this.attachTimer !== null) {
            clearInterval(this.attachTimer);
            this.attachTimer = null;
        }
        this.inputEnd();
        if (this.trackedInput) {
            this.trackedInput.removeEventListener("input", this.onInputBound);
            this.trackedInput.removeEventListener("blur", this.onBlurBound);
            this.trackedInput = null;
        }
        this.received.clear();
        super.Unload();
    }

    private ensureInputTracked(): void {
        const element = document.getElementById("InputChat") as HTMLTextAreaElement | null;
        if (element === this.trackedInput) {
            return;
        }
        if (this.trackedInput) {
            this.trackedInput.removeEventListener("input", this.onInputBound);
            this.trackedInput.removeEventListener("blur", this.onBlurBound);
        }
        this.trackedInput = element;
        if (element) {
            element.addEventListener("input", this.onInputBound);
            element.addEventListener("blur", this.onBlurBound);
            debug("Typing indicator attached to the chat input");
        }
    }

    /** Statuses of people who left the room must not linger. */
    private pruneToRoster(): void {
        if (this.received.size === 0 || !ServerPlayerIsInChatRoom()) {
            return;
        }
        const present = new Set(ChatRoomCharacter.map((c) => c.MemberNumber));
        for (const member of [...this.received.keys()]) {
            if (!present.has(member)) {
                this.received.delete(member);
            }
        }
    }

    /** Same classification BCX applies to the input value. */
    private onInput(): void {
        if (this.standDown() || this.getSetting<boolean>("broadcast") !== true
            || !ServerPlayerIsInChatRoom()) {
            return;
        }
        const value = this.trackedInput?.value ?? "";
        let status: StatusType = "None";
        let target: number | null = null;
        if (value.length > 1) {
            status = "Typing";
            if (value.startsWith("*") || value.startsWith("/me ") || value.startsWith("/emote ") || value.startsWith("/action ")) {
                status = "Emote";
            } else if ((value.startsWith("/") && !value.startsWith("//"))
                || (value.startsWith(".") && !value.startsWith(".."))) {
                status = "None";
            } else if (ChatRoomTargetMemberNumber >= 0) {
                status = "Whisper";
                target = ChatRoomTargetMemberNumber;
            }
        }
        if (this.idleTimer !== null) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
        if (status !== "None") {
            this.idleTimer = setTimeout(() => this.inputEnd(), IDLE_TIMEOUT_MS);
        }
        this.setOwnStatus(status, target);
    }

    private inputEnd(): void {
        if (this.idleTimer !== null) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
        this.setOwnStatus("None", null);
    }

    private setOwnStatus(status: StatusType, target: number | null): void {
        if (status === this.ownStatus && target === this.ownTarget) {
            return;
        }
        // A whisper target change clears the old target's view first
        // (BCX-compatible sequencing)
        if (this.ownTarget !== target && this.ownStatus !== "None") {
            this.sendStatus("None", this.ownTarget);
        }
        this.ownStatus = status;
        this.ownTarget = target;
        if (status !== "None" || target === null) {
            this.sendStatus(status, target);
        }
    }

    private sendStatus(type: StatusType, target: number | null): void {
        if (!ServerPlayerIsInChatRoom()) {
            return;
        }
        ServerSend("ChatRoomChat", {
            Content: "BCXMsg",
            Type: "Hidden",
            ...(target !== null ? { Target: target } : {}),
            Dictionary: { type: "ChatRoomStatusEvent", message: { Type: type, Target: target } },
        } as unknown as ServerChatRoomMessage);
    }

    private statusOf(C: Character): StatusType {
        if (C.ID === 0) {
            return this.getSetting<boolean>("broadcast") === true ? this.ownStatus : "None";
        }
        if (typeof C.MemberNumber !== "number") {
            return "None";
        }
        return this.received.get(C.MemberNumber)?.type ?? "None";
    }

    /**
     * A hand-drawn speech bubble: white with three dots (middle one pulsing),
     * faded while whispering, an asterisk while composing an emote.
     */
    private drawBubble(x: number, y: number, w: number, h: number, status: StatusType): void {
        const ctx = MainCanvas;
        const bw = w;
        const bh = h * 0.72;
        const r = bh * 0.32;
        ctx.save();
        ctx.globalAlpha = status === "Whisper" ? 0.55 : 1;
        ctx.fillStyle = "#FFFFFF";
        ctx.strokeStyle = "#202020";
        ctx.lineWidth = Math.max(1.5, w * 0.055);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + bw - r, y);
        ctx.quadraticCurveTo(x + bw, y, x + bw, y + r);
        ctx.lineTo(x + bw, y + bh - r);
        ctx.quadraticCurveTo(x + bw, y + bh, x + bw - r, y + bh);
        ctx.lineTo(x + bw * 0.45, y + bh);
        ctx.lineTo(x + bw * 0.22, y + bh + h * 0.26);
        ctx.lineTo(x + bw * 0.32, y + bh);
        ctx.lineTo(x + r, y + bh);
        ctx.quadraticCurveTo(x, y + bh, x, y + bh - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#202020";
        if (status === "Emote") {
            ctx.font = `bold ${Math.round(bh * 0.8)}px Arial`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("*", x + bw / 2, y + bh * 0.62);
        } else {
            const beat = Math.floor(CommonTime() / 350) % 3;
            for (let dot = 0; dot < 3; dot++) {
                const radius = bh * (dot === beat ? 0.11 : 0.08);
                ctx.beginPath();
                ctx.arc(x + bw * (0.28 + dot * 0.22), y + bh * 0.5, radius, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.restore();
    }
}
