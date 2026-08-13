import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig } from "@/system/module/ModuleTypes";
import { BCPLUS_AUTHOR, BCPLUS_VERSION } from "@/system/Constants";
import { GUIScreen } from "@/system/gui/GUIScreen";
import { WeldingScreen } from "@/gui/WeldingScreen";
import { err } from "@/system/Console";
import {
    BCPMessageContent,
    BCPNotifyPlayer,
    FindCharacterInRoom,
    SendAction,
    SendBCPMessage,
} from "@/utils/Messaging";
import { getChatroomCharacter } from "@/utils/BCPlusCharacter";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";
import type Rules from "@/modules/Rules";
import type Logging from "@/modules/Logging";

/** Rules that are forced on and locked against everyone while welded. */
export const WELD_LOCKED_RULES: readonly string[] = ["protect.ownerChanges"];

/** Whisper subcommands answered by this module, not the Commands module. */
export const WELD_WHISPER_COMMANDS: readonly string[] = ["weld", "accept", "decline"];

const CEREMONY_MS = 10 * 60_000;
/** Consecutive ticks without the welded owner before the weld dissolves (guards against transient BC state). */
const DISSOLVE_TICKS = 3;

/** The in-progress three-way vetting, stored (publicly synced) until it completes or fails. */
export interface WeldCeremony {
    initiator: number;
    owner: number;
    ownerName: string;
    sub: number;
    subName: string;
    witness: number | null;
    witnessName: string | null;
    accepted: number[];
    deadline: number;
}

/**
 * Collar welding: a three-way vetted, near-irreversible lock on the player's
 * BC ownership. Owner, submissive and a witness (a BC friend of the sub) must
 * all accept within 10 minutes, everyone in the same room. Once welded, the
 * owner-protection rule is forced on and locked, factory reset is disabled,
 * and only the owner releasing the sub in BC itself undoes it.
 *
 * The ceremony always runs and validates on the SUB's client - requesters
 * are never trusted. The owner and witness do not need BC+: they can accept
 * by whispering "!bcp accept" to the sub.
 */
export default class Welding extends ModuleInstance {

    protected readonly SystemConfig: ModuleConfig = {
        Name: "Welding",
        Version: BCPLUS_VERSION,
        Author: BCPLUS_AUTHOR,
        Description: "Weld your collar shut - permanently",
        Active: true,
        Icon: "Icons/Lock.png",
        HoverText: "Welding locks your BC ownership beyond change: vetted by your owner, you and "
            + "a witness, undone only by your owner releasing you. Read the page carefully "
            + "before starting - this is meant to be as close to permanent as BC+ can make it.",
        PublicData: true,
        Reference: "welding",
        MenuString: "Welding",
    };

    override get Defaults(): Record<string, unknown> {
        return {
            welded: false,
            weldOwner: null,
            weldOwnerName: null,
            weldWitness: null,
            weldWitnessName: null,
            weldedAt: null,
            ceremony: null,
        };
    }

    override get HasGUI(): boolean {
        return true;
    }

    override get SupportsRemote(): boolean {
        return true;
    }

    override get SettingsScreen(): ((character: BCPlusCharacter | null) => GUIScreen) | null {
        return (character) => new WeldingScreen(this, character);
    }

    isWelded(): boolean {
        return this.Data.welded === true;
    }

    /** Rule ids currently locked by the weld (empty while not welded). */
    lockedRuleIds(): string[] {
        return this.isWelded() ? [...WELD_LOCKED_RULES] : [];
    }

    get Ceremony(): WeldCeremony | null {
        const raw = this.Data.ceremony;
        return typeof raw === "object" && raw !== null ? raw as WeldCeremony : null;
    }

    get WeldInfo(): { owner: number; ownerName: string; witnessName: string; weldedAt: number } | null {
        if (!this.isWelded()) {
            return null;
        }
        return {
            owner: this.Data.weldOwner as number,
            ownerName: String(this.Data.weldOwnerName ?? "?"),
            witnessName: String(this.Data.weldWitnessName ?? "?"),
            weldedAt: typeof this.Data.weldedAt === "number" ? this.Data.weldedAt : 0,
        };
    }

    private tickTimer: ReturnType<typeof setInterval> | null = null;
    /** Consecutive ticks the welded owner has been missing from Player.Ownership. */
    private dissolveCount = 0;
    /** Invitation received from a sub whose weld we may accept (in-memory only). */
    private pendingInvite: { sub: number; name: string; deadline: number } | null = null;

    override Load(): void {
        // A ceremony never survives a reload - the 10-minute window is live
        this.Data.ceremony = null;
        if (this.isWelded()) {
            this.enforceWeldLocks();
        }

        this.addSyncListener("WeldCommand", (sender, content) => this.onWeldCommand(sender, content));
        this.addSyncListener("WeldCommandResult", (sender, content) => {
            if (content.ok === false) {
                BCPNotifyPlayer(`${sender.Name} could not apply the welding action${typeof content.reason === "string" ? `: ${content.reason}` : "."}`);
            } else {
                BCPNotifyPlayer(`Welding action accepted by ${sender.Name}.`);
            }
        });
        this.addSyncListener("WeldInvite", (sender, content) => {
            if (typeof sender.MemberNumber !== "number") {
                return;
            }
            this.pendingInvite = {
                sub: sender.MemberNumber,
                name: sender.Name,
                deadline: typeof content.deadline === "number" ? content.deadline : Date.now() + CEREMONY_MS,
            };
            BCPNotifyPlayer(`${sender.Name} (#${sender.MemberNumber}) asks you to take part in welding their collar. `
                + "Accept with /bcp accept, or on their BC+ Welding page.");
        });

        // Whisper interface so the owner and witness need no BC+ at all
        this.addHook("ChatRoomMessage", 3, (args, next) => {
            const result = next(args);
            try {
                this.onWhisper(args[0] as ServerChatRoomMessage);
            } catch (e) {
                err("Weld whisper handling failed:", e);
            }
            return result;
        });

        this.tickTimer = setInterval(() => this.tick(), 5000);
    }

    override Unload(): void {
        if (this.tickTimer !== null) {
            clearInterval(this.tickTimer);
            this.tickTimer = null;
        }
        super.Unload();
    }

    // --- Ceremony flow (all on the sub's client) ---

    /** Starts a ceremony; the initiator must be the sub (locally) or their owner. */
    startCeremony(initiator: number): true | string {
        if (this.isWelded()) {
            return "the collar is already welded";
        }
        if (this.Ceremony !== null) {
            return "a welding is already in progress";
        }
        const ownership = Player.Ownership;
        if (!ownership || typeof ownership.MemberNumber !== "number") {
            return "there is no club owner to weld to";
        }
        if (ownership.Stage !== 1) {
            return "the collar is still on trial - welding needs a full collar";
        }
        if (this.Preset === "Dominant") {
            return "the Dominant preset does not accept rules, so it cannot be welded";
        }
        const sub = Player.MemberNumber ?? -1;
        const owner = ownership.MemberNumber;
        if (initiator !== sub && initiator !== owner) {
            return "only the owner or the submissive can initiate a welding";
        }
        if (!FindCharacterInRoom(owner, { MemberNumber: true, Nickname: false, Name: false })) {
            return "owner and submissive must be in the same room";
        }

        const subName = Player.Nickname || Player.Name;
        this.Data.ceremony = {
            initiator,
            owner,
            ownerName: ownership.Name,
            sub,
            subName,
            witness: null,
            witnessName: null,
            accepted: [initiator],
            deadline: Date.now() + CEREMONY_MS,
        } satisfies WeldCeremony;

        if (initiator === sub) {
            this.inviteParticipant(owner, `${subName} has initiated the welding of their collar. `
                + `Accept within 10 minutes by whispering "!bcp accept" to ${subName}.`);
            BCPNotifyPlayer(`Welding initiated - your owner ${ownership.Name} has been asked to accept. `
                + "Now choose a witness: a BC friend of yours in this room.");
        } else {
            BCPNotifyPlayer(`Your owner ${ownership.Name} has initiated the welding of your collar! `
                + "Accept on the Welding page or with /bcp accept, and choose a witness: "
                + "a BC friend of yours in this room.");
        }
        this.log(`Welding initiated by ${initiator === sub ? subName : ownership.Name} (#${initiator})`);
        return true;
    }

    /** Sets (or replaces) the witness - only meaningful on the sub's own client. */
    setWitness(member: number): true | string {
        const ceremony = this.Ceremony;
        if (!ceremony) {
            return "no welding is in progress";
        }
        if (member === ceremony.owner || member === ceremony.sub) {
            return "the witness must be a third party - not the owner or the submissive";
        }
        if (!Player.FriendList?.includes(member)) {
            return "the witness must be one of your BC friends";
        }
        const character = FindCharacterInRoom(member, { MemberNumber: true, Nickname: false, Name: false });
        if (!character) {
            return "the witness must be in this room";
        }
        if (ceremony.witness !== null) {
            // Replacing: the previous witness's acceptance no longer counts
            ceremony.accepted = ceremony.accepted.filter((m) => m !== ceremony.witness);
        }
        ceremony.witness = member;
        ceremony.witnessName = character.Name;
        this.inviteParticipant(member, `${ceremony.subName} asks you to witness the welding of their collar. `
            + `Accept within the time window by whispering "!bcp accept" to ${ceremony.subName}.`);
        BCPNotifyPlayer(`${character.Name} (#${member}) has been asked to witness the welding.`);
        return true;
    }

    /** Records a participant's acceptance; completes the weld when all three agreed. */
    accept(member: number): true | string {
        const ceremony = this.Ceremony;
        if (!ceremony) {
            return "no welding is in progress";
        }
        if (member !== ceremony.owner && member !== ceremony.sub && member !== ceremony.witness) {
            return "you are not part of this welding";
        }
        if (ceremony.accepted.includes(member)) {
            return "already accepted";
        }
        if (!FindCharacterInRoom(member, { MemberNumber: true, Nickname: false, Name: false })
            && member !== Player.MemberNumber) {
            return "you must be in the room to accept";
        }
        ceremony.accepted.push(member);
        const name = member === ceremony.owner ? ceremony.ownerName
            : member === ceremony.sub ? ceremony.subName : (ceremony.witnessName ?? "?");
        BCPNotifyPlayer(`${name} (#${member}) accepted the welding (${ceremony.accepted.length}/3).`);
        this.tryComplete();
        return true;
    }

    /** Any participant declining (or the sub cancelling) calls the whole thing off. */
    decline(member: number): true | string {
        const ceremony = this.Ceremony;
        if (!ceremony) {
            return "no welding is in progress";
        }
        if (member !== ceremony.owner && member !== ceremony.sub && member !== ceremony.witness) {
            return "you are not part of this welding";
        }
        const name = member === ceremony.owner ? ceremony.ownerName
            : member === ceremony.sub ? ceremony.subName : (ceremony.witnessName ?? "?");
        this.Data.ceremony = null;
        BCPNotifyPlayer(`${name} (#${member}) declined - the welding will not happen.`);
        for (const other of [ceremony.owner, ceremony.witness]) {
            if (other !== null && other !== member) {
                const character = FindCharacterInRoom(other, { MemberNumber: true, Nickname: false, Name: false });
                if (character) {
                    SendAction(`BC+: ${name} declined the welding of ${ceremony.subName}'s collar - it will not happen.`, character);
                }
            }
        }
        this.log(`Welding declined by ${name} (#${member})`);
        return true;
    }

    /** Accepts as this client: the sub's own ceremony first, else a received invitation. */
    acceptAsPlayer(): true | string {
        const ceremony = this.Ceremony;
        const self = Player.MemberNumber ?? -1;
        if (ceremony && !ceremony.accepted.includes(self)) {
            return this.accept(self);
        }
        if (this.pendingInvite && Date.now() < this.pendingInvite.deadline) {
            SendBCPMessage({ message: "WeldCommand", action: "accept" }, this.pendingInvite.sub);
            return true;
        }
        return "no welding request is waiting for you";
    }

    /** Declines as this client: the sub's own ceremony first, else a received invitation. */
    declineAsPlayer(): true | string {
        if (this.Ceremony) {
            return this.decline(Player.MemberNumber ?? -1);
        }
        if (this.pendingInvite && Date.now() < this.pendingInvite.deadline) {
            SendBCPMessage({ message: "WeldCommand", action: "decline" }, this.pendingInvite.sub);
            this.pendingInvite = null;
            return true;
        }
        return "no welding request is waiting for you";
    }

    /**
     * Completes the weld once all three acceptances are in - re-validating
     * everything, because the world may have changed since initiation. Called
     * after each acceptance and from the tick (someone may have re-entered
     * the room after accepting earlier).
     */
    private tryComplete(): void {
        const ceremony = this.Ceremony;
        if (!ceremony || ceremony.witness === null) {
            return;
        }
        if (![ceremony.owner, ceremony.sub, ceremony.witness].every((m) => ceremony.accepted.includes(m))) {
            return;
        }
        const ownership = Player.Ownership;
        if (!ownership || ownership.MemberNumber !== ceremony.owner || ownership.Stage !== 1) {
            this.Data.ceremony = null;
            BCPNotifyPlayer("The welding failed - the ownership changed during the ceremony.");
            return;
        }
        if (!Player.FriendList?.includes(ceremony.witness)) {
            this.Data.ceremony = null;
            BCPNotifyPlayer("The welding failed - the witness is no longer one of your BC friends.");
            return;
        }
        for (const member of [ceremony.owner, ceremony.witness]) {
            if (!FindCharacterInRoom(member, { MemberNumber: true, Nickname: false, Name: false })) {
                // Not fatal: the tick retries until the window closes
                return;
            }
        }

        this.Data.welded = true;
        this.Data.weldOwner = ceremony.owner;
        this.Data.weldOwnerName = ceremony.ownerName;
        this.Data.weldWitness = ceremony.witness;
        this.Data.weldWitnessName = ceremony.witnessName;
        this.Data.weldedAt = Date.now();
        this.Data.ceremony = null;
        this.dissolveCount = 0;
        this.enforceWeldLocks();

        SendAction(`${ceremony.subName}'s collar has been welded shut by ${ceremony.ownerName}, `
            + `witnessed by ${ceremony.witnessName}. What has been welded cannot be unlocked.`);
        BCPNotifyPlayer("Your collar is welded shut. The owner-protection rule is locked, and the "
            + "BC+ factory reset is disabled. Only your owner releasing you undoes this.");
        this.log(`Collar welded to ${ceremony.ownerName} (#${ceremony.owner}), `
            + `witnessed by ${ceremony.witnessName} (#${ceremony.witness})`);
    }

    /** Forces the weld-locked rules on. Also re-run after Load and rule imports. */
    enforceWeldLocks(): void {
        const rules = this.ModuleManager.getModule<Rules>("rules");
        if (!rules || !this.isWelded()) {
            return;
        }
        const by = {
            member: typeof this.Data.weldOwner === "number" ? this.Data.weldOwner : -1,
            name: String(this.Data.weldOwnerName ?? "Welding"),
        };
        for (const id of this.lockedRuleIds()) {
            if (!rules.ruleState(id).active) {
                rules.setRuleActive(id, true, by);
            }
            rules.setRuleEnforce(id, true);
        }
    }

    /** The only exit: the owner releasing the sub in BC dissolves the weld. */
    private dissolveWeld(): void {
        const ownerName = String(this.Data.weldOwnerName ?? "your owner");
        this.Data.welded = false;
        this.Data.weldOwner = null;
        this.Data.weldOwnerName = null;
        this.Data.weldWitness = null;
        this.Data.weldWitnessName = null;
        this.Data.weldedAt = null;
        BCPNotifyPlayer(`${ownerName} has released you - the weld on your collar is undone. `
            + "The owner-protection rule stays active but is no longer locked.");
        this.log(`The weld dissolved - released by ${ownerName}`);
    }

    private tick(): void {
        const ceremony = this.Ceremony;
        if (ceremony) {
            if (Date.now() > ceremony.deadline) {
                this.Data.ceremony = null;
                BCPNotifyPlayer("The welding request expired - not everyone accepted within 10 minutes.");
                this.log("Welding expired - not everyone accepted in time");
            } else {
                this.tryComplete();
            }
        }
        if (this.pendingInvite && Date.now() > this.pendingInvite.deadline) {
            this.pendingInvite = null;
        }
        if (this.isWelded()) {
            const ownership = Player.Ownership;
            if (ownership && ownership.MemberNumber === this.Data.weldOwner) {
                this.dissolveCount = 0;
            } else if (++this.dissolveCount >= DISSOLVE_TICKS) {
                this.dissolveCount = 0;
                this.dissolveWeld();
            }
        }
    }

    // --- Remote interfaces ---

    /** Notifies a participant: BC+ users get a proper invite, others a whispered action line. */
    private inviteParticipant(member: number, actionText: string): void {
        const ceremony = this.Ceremony;
        if (getChatroomCharacter(member)?.BCPVersion) {
            SendBCPMessage({ message: "WeldInvite", deadline: ceremony?.deadline }, member);
            return;
        }
        const character = FindCharacterInRoom(member, { MemberNumber: true, Nickname: false, Name: false });
        if (character) {
            SendAction(`BC+: ${actionText}`, character);
        }
    }

    /** Remote init/accept/decline from BC+ clients - identity-validated HERE. */
    private onWeldCommand(sender: Character, content: BCPMessageContent): void {
        const senderNumber = sender.MemberNumber;
        if (typeof senderNumber !== "number") {
            return;
        }
        let result: true | string;
        if (content.action === "init") {
            result = this.startCeremony(senderNumber);
        } else if (content.action === "accept") {
            result = this.accept(senderNumber);
        } else if (content.action === "decline") {
            result = this.decline(senderNumber);
        } else {
            result = "invalid command";
        }
        SendBCPMessage({
            message: "WeldCommandResult",
            ok: result === true,
            reason: result === true ? undefined : result,
        }, senderNumber);
    }

    /** Whispered "!bcp weld/accept/decline" - works without the sender running BC+. */
    private onWhisper(data: ServerChatRoomMessage): void {
        if (data.Type !== "Whisper" || typeof data.Content !== "string" || typeof data.Sender !== "number"
            || data.Sender === Player.MemberNumber) {
            return;
        }
        let text = data.Content.trim();
        if (text.startsWith("(")) {
            text = text.replace(/^\(+/, "").replace(/\)+$/, "").trim();
        }
        const match = /^!bcp\b\s*(\S*)/i.exec(text);
        const commandId = (match?.[1] ?? "").toLocaleLowerCase();
        if (!WELD_WHISPER_COMMANDS.includes(commandId)) {
            return;
        }
        const sender = FindCharacterInRoom(data.Sender, { MemberNumber: true, Nickname: false, Name: false });
        if (!sender) {
            return;
        }
        let result: true | string;
        let done: string;
        if (commandId === "weld") {
            result = this.startCeremony(data.Sender);
            done = "Welding initiated - now all three of you must accept within 10 minutes.";
        } else if (commandId === "accept") {
            result = this.accept(data.Sender);
            done = "Your acceptance is recorded.";
        } else {
            result = this.decline(data.Sender);
            done = "The welding is called off.";
        }
        SendAction(`BC+: ${result === true ? done : `That did not work: ${result}.`}`, sender);
    }

    private log(message: string): void {
        this.ModuleManager.getModule<Logging>("logging")?.log("other", message);
    }
}
