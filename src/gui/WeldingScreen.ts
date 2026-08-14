import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { ButtonActionWidget } from "@/system/gui/Widgets";
import { UserSelectScreen } from "@/gui/UserSelectScreen";
import { BCPNotifyPlayer, SendBCPMessage } from "@/utils/Messaging";
import type Welding from "@/modules/Welding";
import type { WeldCeremony } from "@/modules/Welding";
import type { GUI } from "@/modules/GUI";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";

const BLURB: readonly string[] = [
    "Welding the collar makes your BC ownership as permanent as BC+ can make it:",
    "• The rule \"Forbid club owner changes\" is forced on, enforced, and locked - nobody",
    "   can pause, deactivate or condition it, not even your owner or you.",
    "• The BC+ factory reset is disabled and the Rules module cannot be switched off.",
    "• Re-importing rules cannot remove the lock.",
    "The ONLY thing that undoes a weld is your owner releasing you in BC itself.",
    "",
    "It takes your owner (full collar - no trial), you, and a witness who is a BC friend",
    "of yours - all three online in this room, all accepting within 10 minutes.",
    "Take it seriously: this is meant to be forever.",
];

function countdown(deadline: number): string {
    const remaining = Math.max(0, deadline - Date.now());
    const minutes = Math.floor(remaining / 60_000);
    const seconds = Math.floor((remaining % 60_000) / 1000);
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The Welding page: explains the weld, shows the requirement checklist, the
 * live three-name ceremony status, or the welded state. Viewed remotely it
 * reads the sub's synced mirror and offers Initiate/Accept to participants.
 */
export class WeldingScreen extends GUIScreen {

    constructor(module: Welding, character: BCPlusCharacter | null) {
        super(module, character);
    }

    get Title(): string {
        return this.Character && !this.Character.isPlayer()
            ? `Welding - ${this.Character.Nickname}`
            : "Welding";
    }

    protected buildPages(): GUIPage[] {
        return [new WeldingPage(this)];
    }
}

class WeldingPage extends GUIPage {

    get Config(): PageOptions {
        return {
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: "Welding is a three-way vetted, near-permanent lock on the submissive's BC "
                + "ownership: the owner, the submissive and a witness (a BC friend of the "
                + "submissive) must all accept within 10 minutes, everyone in the same room. "
                + "Either the owner or the submissive can start it. People without BC+ take part "
                + "by whispering \"!bcp accept\" to the submissive. Once welded, only the owner "
                + "releasing the submissive in BC undoes it.",
        };
    }

    private get welding(): Welding {
        return this.Screen.Module as Welding;
    }

    private get local(): boolean {
        return this.Character === null || this.Character.isPlayer();
    }

    render(): void {
        MainCanvas.textAlign = "left";
        let y = 200;
        for (const line of BLURB) {
            if (line.length > 0) {
                DrawTextFit(line, 150, y, 1700, line.startsWith("•") || line.startsWith(" ") ? "Gray" : "Black");
            }
            y += 40;
        }
        DrawEmptyRect(150, 620, 1700, 0, "Gray", 2);

        if (this.local) {
            this.renderLocal();
        } else {
            this.renderRemote();
        }
    }

    // --- Own view: the ceremony truly runs here ---

    private renderLocal(): void {
        const welding = this.welding;
        const info = welding.WeldInfo;
        if (info) {
            this.renderWeldedStatus(info.ownerName, info.owner, info.witnessName, info.weldedAt);
            return;
        }
        const ceremony = welding.Ceremony;
        if (ceremony) {
            this.renderCeremony(ceremony, Player.MemberNumber ?? -1, true);
            return;
        }
        this.renderChecklist();
    }

    private renderChecklist(): void {
        const ownership = Player.Ownership;
        const hasCollar = ownership !== undefined && typeof ownership?.MemberNumber === "number" && ownership.Stage === 1;
        const ownerHere = hasCollar
            && ChatRoomCharacter.some((c) => c.MemberNumber === ownership.MemberNumber);
        const friendHere = ChatRoomCharacter.some((c) =>
            typeof c.MemberNumber === "number"
            && c.MemberNumber !== Player.MemberNumber
            && c.MemberNumber !== ownership?.MemberNumber
            && Player.FriendList?.includes(c.MemberNumber));

        MainCanvas.textAlign = "left";
        DrawText("Requirements:", 150, 680, "Black");
        const checks: { ok: boolean; label: string }[] = [
            { ok: hasCollar, label: "You are fully collared (not on trial)" },
            { ok: ownerHere, label: "Your owner is in this room" },
            { ok: friendHere, label: "A BC friend of yours is in this room to witness" },
        ];
        checks.forEach((check, i) => {
            const cy = 730 + i * 50;
            DrawText(check.ok ? "✓" : "✗", 170, cy, check.ok ? "Green" : "#A00000");
            DrawText(check.label, 230, cy, check.ok ? "Black" : "Gray");
        });

        MainCanvas.textAlign = "center";
        this.addClickHandler(ButtonActionWidget(
            { Left: 1400, Top: 780, Width: 400, Height: 70 },
            {
                Name: "Initiate welding",
                Active: hasCollar && ownerHere,
                HoverText: "Starts the 10-minute three-way vetting - your owner is asked to accept",
            },
            () => this.notifyResult(this.welding.startCeremony(Player.MemberNumber ?? -1)),
        ));
    }

    private renderCeremony(ceremony: WeldCeremony, viewer: number, localCeremony: boolean): void {
        MainCanvas.textAlign = "left";
        DrawText(`Welding in progress - ${countdown(ceremony.deadline)} left`, 150, 680, "#A00000");

        const rows: { role: string; name: string; member: number | null }[] = [
            { role: "Owner", name: ceremony.ownerName, member: ceremony.owner },
            { role: "Submissive", name: ceremony.subName, member: ceremony.sub },
            { role: "Witness", name: ceremony.witnessName ?? "not chosen yet", member: ceremony.witness },
        ];
        rows.forEach((row, i) => {
            const cy = 730 + i * 50;
            DrawText(row.role, 170, cy, "Gray");
            DrawText(row.member !== null ? `${row.name} (#${row.member})` : row.name, 400, cy, "Black");
            if (row.member !== null) {
                const accepted = ceremony.accepted.includes(row.member);
                DrawText(accepted ? "Accepted" : "Waiting...", 1050, cy, accepted ? "Green" : "Gray");
            }
        });

        MainCanvas.textAlign = "center";
        const accepted = ceremony.accepted.includes(viewer);
        const participant = viewer === ceremony.owner || viewer === ceremony.sub || viewer === ceremony.witness;
        this.addClickHandler(ButtonActionWidget(
            { Left: 1400, Top: 700, Width: 400, Height: 64 },
            { Name: "Accept", Active: participant && !accepted },
            () => this.sendOrRun(ceremony, "accept"),
        ));
        if (localCeremony) {
            this.addClickHandler(ButtonActionWidget(
                { Left: 1400, Top: 780, Width: 400, Height: 64 },
                {
                    Name: ceremony.witness === null ? "Choose witness..." : "Change witness...",
                    HoverText: "A BC friend of yours, present in this room",
                },
                () => {
                    this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(new UserSelectScreen(
                        this.Screen.Module,
                        this.Character,
                        (member) => this.notifyResult(this.welding.setWitness(member)),
                        [ceremony.owner],
                    ));
                },
            ));
        }
        this.addClickHandler(ButtonActionWidget(
            { Left: 1400, Top: 860, Width: 400, Height: 64 },
            { Name: "Decline / cancel", Active: participant },
            () => this.sendOrRun(ceremony, "decline"),
        ));
    }

    private renderWeldedStatus(ownerName: string, owner: number, witnessName: string, weldedAt: number): void {
        MainCanvas.textAlign = "left";
        DrawText("This collar is WELDED SHUT.", 150, 690, "#A00000");
        DrawText(`Owner: ${ownerName} (#${owner})`, 150, 745, "Black");
        DrawText(`Witnessed by ${witnessName}${weldedAt > 0 ? ` on ${new Date(weldedAt).toLocaleDateString()}` : ""}`, 150, 795, "Black");
        DrawText("It ends only when the owner releases the submissive in BC.", 150, 850, "Gray");
    }

    // --- Remote view: read the sub's mirror, act by sending WeldCommands ---

    private renderRemote(): void {
        const mirror = this.Character?.BCPData?.["welding"];
        if (!mirror) {
            MainCanvas.textAlign = "left";
            DrawText("No welding data received from this player yet.", 150, 690, "Gray");
            return;
        }
        if (mirror["welded"] === true) {
            this.renderWeldedStatus(
                String(mirror["weldOwnerName"] ?? "?"),
                typeof mirror["weldOwner"] === "number" ? mirror["weldOwner"] : -1,
                String(mirror["weldWitnessName"] ?? "?"),
                typeof mirror["weldedAt"] === "number" ? mirror["weldedAt"] : 0,
            );
            return;
        }
        const ceremony = mirror["ceremony"] as WeldCeremony | null | undefined;
        if (ceremony && typeof ceremony === "object") {
            this.renderCeremony(ceremony, Player.MemberNumber ?? -1, false);
            return;
        }

        MainCanvas.textAlign = "left";
        DrawText("No welding is in progress.", 150, 690, "Gray");
        // Only this sub's BC owner can initiate from outside
        const isTheirOwner = this.Character?.Character.Ownership?.MemberNumber === Player.MemberNumber;
        MainCanvas.textAlign = "center";
        this.addClickHandler(ButtonActionWidget(
            { Left: 1400, Top: 780, Width: 400, Height: 70 },
            {
                Name: "Initiate welding",
                Active: isTheirOwner,
                HoverText: isTheirOwner
                    ? "Starts the 10-minute three-way vetting on their client"
                    : "Only this player's BC owner can initiate a welding",
            },
            () => SendBCPMessage({ message: "WeldCommand", action: "init" }, this.Character!.MemberNumber),
        ));
    }

    /** Ceremony actions run locally on the sub's client, remotely everywhere else. */
    private sendOrRun(ceremony: WeldCeremony, action: "accept" | "decline"): void {
        if (this.local) {
            const viewer = Player.MemberNumber ?? -1;
            this.notifyResult(action === "accept" ? this.welding.accept(viewer) : this.welding.decline(viewer));
        } else {
            SendBCPMessage({ message: "WeldCommand", action }, ceremony.sub);
        }
    }

    private notifyResult(result: true | string): void {
        if (result !== true) {
            BCPNotifyPlayer(`That did not work: ${result}.`);
        }
    }
}
