import { ModuleInstance } from "@/system/module/ModuleInstance";
import { ModuleConfig } from "@/system/module/ModuleTypes";
import { BCPLUS_AUTHOR, BCPLUS_VERSION } from "@/system/Constants";
import {
    ContractDraft, ContractPayload, MAX_ACTIVE_CONTRACTS, MAX_DRAFTS, SignedContract,
    describeContractDuration, sanitizeContractPayload,
} from "@/system/contracts/ContractTypes";
import { ContractsScreen } from "@/gui/ContractsScreen";
import { GUIScreen } from "@/system/gui/GUIScreen";
import { BCPMessageContent, BCPNotifyPlayer, FindCharacterInRoom, SendAction, SendBCPMessage } from "@/utils/Messaging";
import { encodeExport } from "@/utils/ExportImport";
import { jsonClone } from "@/utils/BCUtils";
import { rememberMember } from "@/utils/MemberCache";
import { debug, err } from "@/system/Console";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";
import type Logging from "@/modules/Logging";
import type Rules from "@/modules/Rules";

const EXPIRY_TICK_MS = 10_000;
/** How long an in-room offer stays reviewable. */
const OFFER_TTL_MS = 30 * 60_000;

/**
 * Contracts: dom-authored bundles of rule state that only take effect after
 * the target countersigns. Drafts are the author's private library; a signed
 * contract binds the signer's rules until it expires or is released.
 * SECURITY INVARIANT: the signer's client validates everything - a payload
 * (code or offer message) is a proposal, never an instruction.
 */
export default class Contracts extends ModuleInstance {

    private tickTimer: ReturnType<typeof setInterval> | null = null;
    /** In-room offer waiting for review (in-memory; does not survive reload). */
    private pendingOffer: { payload: ContractPayload; receivedAt: number } | null = null;

    protected readonly SystemConfig: ModuleConfig = {
        Name: "Contracts",
        Version: BCPLUS_VERSION,
        Author: BCPLUS_AUTHOR,
        Description: "Rule bundles that take effect when the target countersigns",
        Active: true,
        Icon: "Icons/Title.png",
        HoverText: "A contract bundles rules with their settings and conditions, authored in "
            + "your own BC+ and offered to someone else - nothing applies until they review "
            + "and countersign it. Signed contracts bind the rules until the contract expires "
            + "or is released per its policy.",
        PublicData: false,
        Reference: "contracts",
        MenuString: "Contracts",
    };

    override get Defaults(): Record<string, unknown> {
        return { drafts: {}, signed: {} };
    }

    override get HasGUI(): boolean {
        return true;
    }

    override get SupportsRemote(): boolean {
        return true;
    }

    override get CanDisable(): boolean {
        return true;
    }

    override get SettingsScreen(): ((character: BCPlusCharacter | null) => GUIScreen) | null {
        return (character) => new ContractsScreen(this, character);
    }

    get Drafts(): Record<string, ContractDraft> {
        return this.Data.drafts as Record<string, ContractDraft>;
    }

    get Signed(): Record<string, SignedContract> {
        return this.Data.signed as Record<string, SignedContract>;
    }

    get PendingOffer(): ContractPayload | null {
        if (this.pendingOffer && Date.now() - this.pendingOffer.receivedAt < OFFER_TTL_MS) {
            return this.pendingOffer.payload;
        }
        return null;
    }

    clearPendingOffer(): void {
        this.pendingOffer = null;
    }

    /** Whether a signed contract currently binds this rule. */
    isRuleContractBound(ruleId: string): boolean {
        return Object.values(this.Signed).some((c) => c.rules[ruleId]?.active === true);
    }

    /** The contract binding a rule, for UI notes. */
    boundBy(ruleId: string): SignedContract | undefined {
        return Object.values(this.Signed).find((c) => c.rules[ruleId]?.active === true);
    }

    private generateId(): string {
        let id: string;
        do {
            id = `c${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
        } while (this.Drafts[id] || this.Signed[id]);
        return id;
    }

    // --- Author side ---

    createDraft(): ContractDraft | null {
        if (Object.keys(this.Drafts).length >= MAX_DRAFTS) {
            BCPNotifyPlayer(`You already have ${MAX_DRAFTS} drafts - delete one first.`);
            return null;
        }
        const draft: ContractDraft = {
            id: this.generateId(),
            title: "New contract",
            terms: "",
            durationMin: 0,
            policy: "author",
            rules: {},
        };
        this.Drafts[draft.id] = draft;
        return draft;
    }

    removeDraft(id: string): void {
        delete this.Drafts[id];
    }

    /** The draft as an offer payload, authored by the player. */
    private draftPayload(draft: ContractDraft): ContractPayload {
        const payload = jsonClone(draft) as ContractDraft & Partial<ContractPayload>;
        delete (payload as Partial<ContractDraft>).id;
        payload.author = Player.MemberNumber ?? -1;
        payload.authorName = Player.Nickname || Player.Name;
        return payload as ContractPayload;
    }

    /** Shareable offer code for a draft. */
    offerCode(draft: ContractDraft): string {
        return encodeExport("contract", this.draftPayload(draft));
    }

    /** Sends the draft as an in-room offer; the target reviews and decides. */
    offerTo(draft: ContractDraft, member: number): boolean {
        const character = FindCharacterInRoom(member, { MemberNumber: true, Nickname: false, Name: false });
        if (!character) {
            BCPNotifyPlayer("They are not in this room.");
            return false;
        }
        SendBCPMessage({ message: "ContractOffer", payload: this.draftPayload(draft) }, member);
        SendAction(`BC+: ${Player.Nickname || Player.Name} offers you the contract "${draft.title}" - review it on your BC+ Contracts page.`, character);
        BCPNotifyPlayer(`Contract "${draft.title}" offered to ${character.Name} (#${member}).`);
        return true;
    }

    /** Asks another member for the contracts THIS player authored on them. */
    queryAuthored(member: number): void {
        SendBCPMessage({ message: "ContractQuery" }, member);
    }

    /** Asks the signer to release a contract this player authored. */
    requestRelease(member: number, contractId: string): void {
        SendBCPMessage({ message: "ContractCommand", action: "release", id: contractId }, member);
    }

    /** Contracts on another member authored by the player (from their reply). */
    private readonly authoredMirror = new Map<number, SignedContract[]>();

    authoredOn(member: number): SignedContract[] | undefined {
        return this.authoredMirror.get(member);
    }

    // --- Signer side ---

    /** Validates and applies a payload; returns true or a refusal reason. */
    sign(payload: ContractPayload): true | string {
        if (this.Preset === "Dominant") {
            return "your Dominant preset does not accept rules";
        }
        if (payload.author === Player.MemberNumber) {
            return "you cannot sign your own contract";
        }
        const rules = this.ModuleManager.getModule<Rules>("rules");
        if (!rules?.Config.Active) {
            return "the Rules module is not active";
        }
        const active = Object.entries(payload.rules).filter(([, spec]) => spec.active);
        if (active.length === 0) {
            return "the contract contains no rules";
        }
        if (Object.keys(this.Signed).length >= MAX_ACTIVE_CONTRACTS) {
            return `you are already bound by ${MAX_ACTIVE_CONTRACTS} contracts`;
        }
        for (const [id] of active) {
            if (!rules.getDefinition(id)) {
                return `it contains a rule this BC+ version does not know (${id})`;
            }
            if (this.isRuleContractBound(id)) {
                return `the rule "${rules.getDefinition(id)!.name}" is already bound by another contract`;
            }
        }

        // Snapshot every touched rule for restoration, then apply the specs
        // through the normal setters (which validate every value)
        const prior: SignedContract["prior"] = {};
        const by = { member: payload.author, name: payload.authorName };
        for (const [id, spec] of active) {
            prior[id] = jsonClone(rules.ruleState(id));
            rules.setRuleEnforce(id, spec.enforce);
            rules.setRuleLog(id, spec.log);
            rules.setRuleAnnounce(id, spec.announce);
            for (const [name, value] of Object.entries(spec.settings)) {
                rules.setRuleSetting(id, name, value);
            }
            if (spec.conditions) {
                rules.setRuleUseGlobal(id, false);
                rules.setRuleConditions(id, spec.conditions);
            } else {
                rules.setRuleUseGlobal(id, spec.useGlobal !== false);
            }
            rules.setRuleActive(id, true, by);
        }

        const contract: SignedContract = {
            ...jsonClone(payload),
            id: this.generateId(),
            signedAt: Date.now(),
            until: payload.durationMin > 0 ? Date.now() + payload.durationMin * 60_000 : null,
            prior,
        };
        this.Signed[contract.id] = contract;
        rememberMember(payload.author, payload.authorName);
        this.pendingOffer = null;

        const name = Player.Nickname || Player.Name;
        if (ServerPlayerIsInChatRoom()) {
            SendAction(`${name} has signed ${payload.authorName}'s contract "${payload.title}" `
                + `(${active.length} rule${active.length === 1 ? "" : "s"}, ${describeContractDuration(payload.durationMin)}).`);
        }
        this.notifyAuthor(payload.author, `${name} has signed your contract "${payload.title}".`);
        BCPNotifyPlayer(`You signed "${payload.title}" - its rules are now bound until the contract ends.`);
        this.log(`Signed the contract "${payload.title}" by ${payload.authorName} (#${payload.author})`);
        return true;
    }

    /** Declines the pending in-room offer. */
    declineOffer(): void {
        const offer = this.PendingOffer;
        this.pendingOffer = null;
        if (offer) {
            this.notifyAuthor(offer.author, `${Player.Nickname || Player.Name} declined the contract "${offer.title}".`);
            BCPNotifyPlayer(`Declined "${offer.title}".`);
        }
    }

    /** Whether the local player may end this contract early. */
    canReleaseLocally(contract: SignedContract): boolean {
        return contract.policy === "either";
    }

    /** Ends a contract: restores every bound rule to its pre-signing state. */
    endContract(id: string, how: "expired" | "released", byName?: string): boolean {
        const contract = this.Signed[id];
        if (!contract) {
            return false;
        }
        // Remove the record FIRST - the rule setters below are guarded
        // against changing contract-bound rules
        delete this.Signed[id];

        const rules = this.ModuleManager.getModule<Rules>("rules");
        for (const [ruleId, prior] of Object.entries(contract.prior)) {
            if (!rules?.getDefinition(ruleId)) {
                continue;
            }
            try {
                rules.setRuleEnforce(ruleId, prior.enforce);
                rules.setRuleLog(ruleId, prior.log);
                rules.setRuleAnnounce(ruleId, prior.announce !== false);
                for (const [name, value] of Object.entries(prior.settings)) {
                    rules.setRuleSetting(ruleId, name, value);
                }
                if (prior.useGlobal !== undefined) {
                    rules.setRuleUseGlobal(ruleId, prior.useGlobal);
                }
                rules.setRuleConditions(ruleId, prior.conditions ?? {});
                rules.setRuleActive(ruleId, prior.active);
            } catch (e) {
                err(`Failed to restore rule ${ruleId} after contract end:`, e);
            }
        }

        const message = how === "expired"
            ? `The contract "${contract.title}" has expired - its rules returned to how they were.`
            : `${byName ?? contract.authorName} released the contract "${contract.title}" - its rules returned to how they were.`;
        BCPNotifyPlayer(message);
        this.log(how === "expired"
            ? `Contract "${contract.title}" expired`
            : `Contract "${contract.title}" released by ${byName ?? "?"}`);
        if (ServerPlayerIsInChatRoom()) {
            SendAction(`${Player.Nickname || Player.Name} is no longer bound by the contract "${contract.title}".`);
        }
        return true;
    }

    private notifyAuthor(member: number, text: string): void {
        const character = FindCharacterInRoom(member, { MemberNumber: true, Nickname: false, Name: false });
        if (character) {
            SendAction(`BC+: ${text}`, character);
        }
    }

    private log(message: string): void {
        this.ModuleManager.getModule<Logging>("logging")?.log("rule", message);
    }

    override Load(): void {
        this.tickTimer = setInterval(() => this.tick(), EXPIRY_TICK_MS);

        this.addSyncListener("ContractOffer", (sender, content) => {
            const payload = sanitizeContractPayload(content.payload);
            if (!payload || typeof sender.MemberNumber !== "number") {
                return;
            }
            // The wire payload's authorship claim is replaced by the actual
            // sender - an in-room offer is always from the person sending it
            payload.author = sender.MemberNumber;
            payload.authorName = sender.Name;
            this.pendingOffer = { payload, receivedAt: Date.now() };
            BCPNotifyPlayer(`${sender.Name} (#${sender.MemberNumber}) offers you the contract "${payload.title}" - `
                + "review it on the BC+ Contracts page.");
        });

        // The author asks which of their contracts bind us - identity-based,
        // they only ever see what they themselves authored
        this.addSyncListener("ContractQuery", (sender) => {
            if (typeof sender.MemberNumber !== "number") {
                return;
            }
            const authored = Object.values(this.Signed).filter((c) => c.author === sender.MemberNumber);
            SendBCPMessage({
                message: "ContractList",
                contracts: jsonClone(authored.map((c) => ({ ...c, prior: {} }))),
            }, sender.MemberNumber);
        });

        this.addSyncListener("ContractList", (sender, content) => {
            if (typeof sender.MemberNumber !== "number" || !Array.isArray(content.contracts)) {
                return;
            }
            this.authoredMirror.set(sender.MemberNumber, content.contracts as SignedContract[]);
            this.Events.emit("characterSyncReceived", { memberNumber: sender.MemberNumber });
        });

        this.addSyncListener("ContractCommand", (sender, content) => this.onContractCommand(sender, content));
    }

    /** Release requests - only the recorded author may release remotely. */
    private onContractCommand(sender: Character, content: BCPMessageContent): void {
        const senderNumber = sender.MemberNumber;
        if (typeof senderNumber !== "number" || content.action !== "release" || typeof content.id !== "string") {
            return;
        }
        const contract = this.Signed[content.id];
        if (!contract) {
            SendAction("BC+: That contract no longer exists.", FindCharacterInRoom(senderNumber, { MemberNumber: true, Nickname: false, Name: false }) ?? undefined);
            return;
        }
        if (contract.author !== senderNumber) {
            debug(`Contract release from #${senderNumber} denied - not the author`);
            return;
        }
        this.endContract(content.id, "released", sender.Name);
        // Refresh their authored view
        const authored = Object.values(this.Signed).filter((c) => c.author === senderNumber);
        SendBCPMessage({
            message: "ContractList",
            contracts: jsonClone(authored.map((c) => ({ ...c, prior: {} }))),
        }, senderNumber);
    }

    override Unload(): void {
        if (this.tickTimer !== null) {
            clearInterval(this.tickTimer);
            this.tickTimer = null;
        }
        super.Unload();
    }

    private tick(): void {
        if (typeof Player === "undefined" || !Player.MemberNumber || !ServerIsConnected) {
            return;
        }
        for (const [id, contract] of Object.entries(this.Signed)) {
            if (contract.until !== null && Date.now() >= contract.until) {
                try {
                    this.endContract(id, "expired");
                } catch (e) {
                    err(`Contract expiry failed for ${id}:`, e);
                }
            }
        }
    }
}
