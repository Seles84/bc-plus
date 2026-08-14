import { GUIPage, GUIScreen, PageOptions } from "@/system/gui/GUIScreen";
import { ButtonActionWidget } from "@/system/gui/Widgets";
import {
    ContractDraft, ContractPayload, ContractRuleSpec, SignedContract,
    describeContractDuration, describeContractPolicy, sanitizeContractPayload,
} from "@/system/contracts/ContractTypes";
import { DraftRuleAccess } from "@/system/contracts/DraftRuleAccess";
import { RuleConfigScreen } from "@/gui/RulesListScreen";
import { UserSelectScreen } from "@/gui/UserSelectScreen";
import { describeConditions } from "@/system/conditions/Conditions";
import { copyExportCode, decodeExport, promptImportCode } from "@/utils/ExportImport";
import { BCPNotifyPlayer, MemberNumberToName } from "@/utils/Messaging";
import { ElementSetVisible } from "@/utils/BCUtils";
import { modalConfirm } from "@/gui/Modal";
import type { GUI } from "@/modules/GUI";
import type { BCPlusCharacter } from "@/utils/BCPlusCharacter";
import type Contracts from "@/modules/Contracts";
import type Rules from "@/modules/Rules";

const DURATION_STEPS = [0, 30, 60, 6 * 60, 12 * 60, 24 * 60, 3 * 24 * 60, 7 * 24 * 60, 14 * 24 * 60, 30 * 24 * 60];

function remainingText(contract: SignedContract): string {
    if (contract.until === null) {
        return "until released";
    }
    const left = contract.until - Date.now();
    if (left <= 0) {
        return "ending";
    }
    return `${describeContractDuration(Math.ceil(left / 60_000))} left`;
}

/** Hub: contracts binding you, your drafts - or (remotely) contracts you authored. */
export class ContractsScreen extends GUIScreen {

    constructor(module: Contracts, character: BCPlusCharacter | null) {
        super(module, character);
    }

    get Title(): string {
        return this.Character && !this.Character.isPlayer()
            ? `Contracts - ${this.Character.Nickname}`
            : "Contracts";
    }

    protected buildPages(): GUIPage[] {
        if (this.Character && !this.Character.isPlayer()) {
            return [new RemoteContractsPage(this)];
        }
        return [new ContractsHubPage(this)];
    }
}

class ContractsHubPage extends GUIPage {

    constructor(protected override readonly screen: ContractsScreen) {
        super(screen);
    }

    private get contracts(): Contracts {
        return this.screen.Module as Contracts;
    }

    get Config(): PageOptions {
        return {
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: this.contracts.Config.HoverText,
        };
    }

    render(): void {
        const contracts = this.contracts;

        // --- Offers and signed contracts (the "bound" side) ---
        MainCanvas.textAlign = "left";
        DrawText("Contracts binding you:", 150, 210, "Black");
        const offer = contracts.PendingOffer;
        let y = 240;
        if (offer) {
            MainCanvas.textAlign = "center";
            this.addClickHandler(ButtonActionWidget(
                { Left: 150, Top: y, Width: 900, Height: 70 },
                { Name: `OFFER: "${offer.title}" from ${offer.authorName}`, HoverText: "Review and sign or decline" },
                () => {
                    this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(
                        new ContractReviewScreen(this.contracts, this.Character, { kind: "offer", payload: offer }),
                    );
                },
            ));
            MainCanvas.textAlign = "left";
            DrawText("Awaiting your review", 1100, y + 35, "#6A3FA0");
            y += 85;
        }
        const signed = Object.values(contracts.Signed);
        if (signed.length === 0 && !offer) {
            DrawText("None.", 180, y + 25, "Gray");
            y += 60;
        }
        for (const contract of signed.slice(0, 3)) {
            MainCanvas.textAlign = "center";
            this.addClickHandler(ButtonActionWidget(
                { Left: 150, Top: y, Width: 900, Height: 70 },
                { Name: `"${contract.title}" - ${contract.authorName}`, HoverText: "View this contract" },
                () => {
                    this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(
                        new ContractReviewScreen(this.contracts, this.Character, { kind: "signed", contract }),
                    );
                },
            ));
            MainCanvas.textAlign = "left";
            DrawTextFit(`${Object.values(contract.rules).filter((r) => r.active).length} rules - ${remainingText(contract)}`, 1100, y + 35, 500, "Gray");
            y += 85;
        }

        // --- Drafts (the author side) ---
        const draftsTop = Math.max(y + 20, 520);
        DrawText("Your contract drafts (offered to others):", 150, draftsTop, "Black");
        const drafts = Object.values(contracts.Drafts);
        if (drafts.length === 0) {
            DrawText("None yet.", 180, draftsTop + 55, "Gray");
        }
        drafts.slice(0, 3).forEach((draft, i) => {
            const rowY = draftsTop + 30 + i * 85;
            MainCanvas.textAlign = "center";
            this.addClickHandler(ButtonActionWidget(
                { Left: 150, Top: rowY, Width: 900, Height: 70 },
                { Name: draft.title, HoverText: "Edit this draft" },
                () => {
                    this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(
                        new ContractDraftScreen(this.contracts, this.Character, draft.id),
                    );
                },
            ));
            MainCanvas.textAlign = "left";
            DrawTextFit(
                `${Object.values(draft.rules).filter((r) => r.active).length} rules - ${describeContractDuration(draft.durationMin)}`,
                1100, rowY + 35, 500, "Gray",
            );
        });
        if (drafts.length > 3) {
            DrawText(`...and ${drafts.length - 3} more.`, 180, draftsTop + 30 + 3 * 85 + 20, "Gray");
        }

        MainCanvas.textAlign = "center";
        this.addClickHandler(ButtonActionWidget(
            { Left: 150, Top: 880, Width: 350, Height: 70 },
            { Name: "New draft", HoverText: "Compose a new contract" },
            () => {
                const draft = this.contracts.createDraft();
                if (draft) {
                    this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(
                        new ContractDraftScreen(this.contracts, this.Character, draft.id),
                    );
                }
            },
        ));
        this.addClickHandler(ButtonActionWidget(
            { Left: 550, Top: 880, Width: 500, Height: 70 },
            { Name: "Review a contract code...", HoverText: "Paste an offered contract code to review and sign it" },
            () => {
                void promptImportCode().then((code) => {
                    if (!code) {
                        return;
                    }
                    const payload = sanitizeContractPayload(decodeExport(code, "contract"));
                    if (!payload) {
                        BCPNotifyPlayer("That is not a valid contract code.");
                        return;
                    }
                    this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(
                        new ContractReviewScreen(this.contracts, this.Character, { kind: "offer", payload }),
                    );
                });
            },
        ));
        MainCanvas.textAlign = "left";
    }
}

const TITLE_INPUT = "BCP_contractTitle";
const TERMS_INPUT = "BCP_contractTerms";
const DRAFT_RULES_PER_PAGE = 4;

/** The composer: title, terms, duration, policy and the rule bundle. */
export class ContractDraftScreen extends GUIScreen {

    constructor(module: Contracts, character: BCPlusCharacter | null, readonly draftId: string) {
        super(module, character);
    }

    get Title(): string {
        return `Draft - ${(this.Module as Contracts).Drafts[this.draftId]?.title ?? "?"}`;
    }

    protected buildPages(): GUIPage[] {
        return [new ContractDraftPage(this)];
    }
}

class ContractDraftPage extends GUIPage {

    private rulePage = 0;

    constructor(protected override readonly screen: ContractDraftScreen) {
        super(screen);
    }

    private get contracts(): Contracts {
        return this.screen.Module as Contracts;
    }

    private get draft(): ContractDraft | undefined {
        return this.contracts.Drafts[this.screen.draftId];
    }

    get Config(): PageOptions {
        return {
            title: this.screen.Title,
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: "Compose the contract: add rules and configure each exactly as it should "
                + "apply on the signer, write the terms, set the duration and who may end it. "
                + "Nothing takes effect until someone signs - offer the draft as a code, or "
                + "directly to a person in the room.",
        };
    }

    override async create(): Promise<void> {
        const draft = this.draft;
        const title = ElementCreateInput(TITLE_INPUT, "text", draft?.title ?? "", "60");
        title.addEventListener("change", () => {
            const current = this.draft;
            if (current && title.value.trim().length > 0) {
                current.title = title.value.trim();
            }
        });
        const terms = ElementCreateInput(TERMS_INPUT, "text", draft?.terms ?? "", "1000");
        terms.addEventListener("change", () => {
            const current = this.draft;
            if (current) {
                current.terms = terms.value;
            }
        });
    }

    override async destroy(): Promise<void> {
        ElementRemove(TITLE_INPUT);
        ElementRemove(TERMS_INPUT);
    }

    render(): void {
        const draft = this.draft;
        if (!draft) {
            DrawText("This draft no longer exists.", 150, 250, "Gray");
            return;
        }
        const rules = this.Core.ModuleManager.getModule<Rules>("rules");
        const helpOpen = this.screen.HelpVisible;

        MainCanvas.textAlign = "left";
        DrawText("Title:", 150, 232, "Black");
        ElementSetVisible(TITLE_INPUT, !helpOpen);
        ElementPosition(TITLE_INPUT, 700, 227, 700, 60);

        DrawText("Terms (shown at signing):", 150, 312, "Black");
        ElementSetVisible(TERMS_INPUT, !helpOpen);
        ElementPosition(TERMS_INPUT, 1050, 307, 1400, 60);

        DrawText("Duration:", 150, 402, "Black");
        MainCanvas.textAlign = "center";
        DrawBackNextButton(480, 370, 350, 64, describeContractDuration(draft.durationMin), "White", "", () => "", () => "");
        this.addClickHandler(() => {
            if (MouseIn(480, 370, 350, 64)) {
                const index = Math.max(0, DURATION_STEPS.indexOf(draft.durationMin));
                const direction = MouseX < 480 + 175 ? -1 : 1;
                draft.durationMin = DURATION_STEPS[(index + direction + DURATION_STEPS.length) % DURATION_STEPS.length]!;
            }
        });
        DrawBackNextButton(950, 370, 500, 64, describeContractPolicy(draft.policy), "White", "", () => "", () => "");
        this.addClickHandler(() => {
            if (MouseIn(950, 370, 500, 64)) {
                draft.policy = draft.policy === "author" ? "either" : "author";
            }
        });
        MainCanvas.textAlign = "left";

        // --- Rules in the bundle ---
        const included = Object.keys(draft.rules).filter((id) => draft.rules[id]!.active && rules?.getDefinition(id));
        DrawText(`Rules in this contract (${included.length}):`, 150, 490, "Black");
        const pageIds = included.slice(this.rulePage * DRAFT_RULES_PER_PAGE, (this.rulePage + 1) * DRAFT_RULES_PER_PAGE);
        pageIds.forEach((id, i) => {
            const definition = rules!.getDefinition(id)!;
            const rowY = 520 + i * 80;
            MainCanvas.textAlign = "center";
            this.addClickHandler(ButtonActionWidget(
                { Left: 150, Top: rowY, Width: 800, Height: 66 },
                { Name: definition.name, HoverText: "Configure how this rule applies at signing" },
                () => {
                    this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(new RuleConfigScreen(
                        rules!, this.Character, definition, new DraftRuleAccess(rules!, this.draft!),
                    ));
                },
            ));
            DrawButton(980, rowY, 60, 60, "X", "White", "", "Remove from the contract");
            MainCanvas.textAlign = "left";
            this.addClickHandler(() => {
                if (MouseIn(980, rowY, 60, 60)) {
                    delete this.draft!.rules[id];
                }
            });
            const spec = draft.rules[id]!;
            DrawTextFit(
                `${spec.enforce ? "Enforced" : "Not enforced"} - ${spec.useGlobal !== false && !spec.conditions ? "signer's global conditions" : describeConditions(spec.conditions)}`,
                1070, rowY + 33, 700, "Gray",
            );
        });
        const rulePages = Math.max(1, Math.ceil(included.length / DRAFT_RULES_PER_PAGE));
        this.rulePage = Math.min(this.rulePage, rulePages - 1);
        if (rulePages > 1) {
            MainCanvas.textAlign = "center";
            DrawBackNextButton(1530, 490 - 32, 250, 56, `Page ${this.rulePage + 1}/${rulePages}`, "White", "", () => "", () => "");
            this.addClickHandler(() => {
                if (MouseIn(1530, 490 - 32, 250, 56)) {
                    const direction = MouseX < 1530 + 125 ? -1 : 1;
                    this.rulePage = (this.rulePage + direction + rulePages) % rulePages;
                }
            });
            MainCanvas.textAlign = "left";
        }

        MainCanvas.textAlign = "center";
        this.addClickHandler(ButtonActionWidget(
            { Left: 150, Top: 860, Width: 280, Height: 70 },
            { Name: "Add rule...", HoverText: "Pick a rule from the catalog" },
            () => {
                this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(
                    new DraftRulePickScreen(this.contracts, this.Character, this.screen.draftId),
                );
            },
        ));
        this.addClickHandler(ButtonActionWidget(
            { Left: 460, Top: 860, Width: 320, Height: 70 },
            { Name: "Copy offer code", Active: included.length > 0, HoverText: "A code the target can review and sign" },
            () => copyExportCode(this.contracts.offerCode(this.draft!)),
        ));
        this.addClickHandler(ButtonActionWidget(
            { Left: 810, Top: 860, Width: 380, Height: 70 },
            { Name: "Offer to someone here...", Active: included.length > 0, HoverText: "Send the offer to a person in this room" },
            () => {
                this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(new UserSelectScreen(
                    this.screen.Module,
                    this.Character,
                    (member) => this.contracts.offerTo(this.draft!, member),
                ));
            },
        ));
        this.addClickHandler(ButtonActionWidget(
            { Left: 1220, Top: 860, Width: 320, Height: 70 },
            { Name: "Delete draft", HoverText: "Removes this draft (signed contracts are unaffected)" },
            () => {
                void modalConfirm(`Delete the draft "${draft.title}"?`).then((confirmed) => {
                    if (confirmed) {
                        this.contracts.removeDraft(this.screen.draftId);
                        this.Screen.exit();
                    }
                });
            },
        ));
        MainCanvas.textAlign = "left";
    }
}

const PICK_PER_PAGE = 10;

/** Catalog picker for adding rules to a draft. */
class DraftRulePickScreen extends GUIScreen {

    constructor(module: Contracts, character: BCPlusCharacter | null, private readonly draftId: string) {
        super(module, character);
    }

    get Title(): string {
        return "Add rule to contract";
    }

    protected buildPages(): GUIPage[] {
        const contracts = this.Module as Contracts;
        const rules = this.Module.ModuleManager.getModule<Rules>("rules");
        const draft = contracts.Drafts[this.draftId];
        const available = (rules?.Definitions ?? [])
            .filter((d) => draft?.rules[d.id]?.active !== true)
            .sort((a, b) => a.category === b.category ? a.name.localeCompare(b.name) : a.category.localeCompare(b.category));
        const pages: GUIPage[] = [];
        for (let i = 0; i < Math.max(1, Math.ceil(available.length / PICK_PER_PAGE)); i++) {
            pages.push(new DraftRulePickPage(this, this.draftId, available.slice(i * PICK_PER_PAGE, (i + 1) * PICK_PER_PAGE)));
        }
        return pages;
    }
}

class DraftRulePickPage extends GUIPage {

    constructor(
        protected override readonly screen: DraftRulePickScreen,
        private readonly draftId: string,
        private readonly rules: { id: string; name: string; category: string }[],
    ) {
        super(screen);
    }

    get Config(): PageOptions {
        return {
            title: this.screen.Title,
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: "Pick a rule to include in the contract - it opens for configuration "
                + "immediately. What you configure is what signing will apply.",
        };
    }

    render(): void {
        const contracts = this.screen.Module as Contracts;
        const rulesModule = this.Core.ModuleManager.getModule<Rules>("rules");
        this.rules.forEach((rule, i) => {
            const y = 200 + i * 75;
            this.addClickHandler(ButtonActionWidget(
                { Left: 150, Top: y, Width: 1100, Height: 64 },
                { Name: rule.name, HoverText: "Add to the contract and configure" },
                () => {
                    const draft = contracts.Drafts[this.draftId];
                    const definition = rulesModule?.getDefinition(rule.id);
                    if (!draft || !definition) {
                        return;
                    }
                    const access = new DraftRuleAccess(rulesModule!, draft);
                    access.setActive(rule.id, true);
                    this.Core.ModuleManager.getModule<GUI>("gui")?.pushSubscreen(
                        new RuleConfigScreen(rulesModule!, this.Character, definition, access),
                    );
                },
            ));
            DrawText(rule.category, 1300, y + 32, "Gray");
        });
    }
}

type ReviewSubject =
    | { kind: "offer"; payload: ContractPayload }
    | { kind: "signed"; contract: SignedContract };

/** Full-disclosure review: everything the contract does, then sign or decline. */
export class ContractReviewScreen extends GUIScreen {

    constructor(module: Contracts, character: BCPlusCharacter | null, readonly subject: ReviewSubject) {
        super(module, character);
    }

    get Title(): string {
        const title = this.subject.kind === "offer" ? this.subject.payload.title : this.subject.contract.title;
        return `Contract - ${title}`;
    }

    protected buildPages(): GUIPage[] {
        return [new ContractReviewPage(this)];
    }
}

class ContractReviewPage extends GUIPage {

    private rulePage = 0;

    constructor(protected override readonly screen: ContractReviewScreen) {
        super(screen);
    }

    private get contracts(): Contracts {
        return this.screen.Module as Contracts;
    }

    get Config(): PageOptions {
        return {
            title: this.screen.Title,
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: "Everything this contract does, rendered from its actual content. Signing "
                + "applies every listed rule exactly as shown and seals them until the contract "
                + "expires or is released per its policy. Read it all before signing.",
        };
    }

    render(): void {
        const subject = this.screen.subject;
        const terms = subject.kind === "offer" ? subject.payload : subject.contract;
        const rules = this.Core.ModuleManager.getModule<Rules>("rules");
        const authorName = subject.kind === "offer"
            ? `${subject.payload.authorName} (#${subject.payload.author})`
            : `${subject.contract.authorName} (#${subject.contract.author})`;

        MainCanvas.textAlign = "left";
        DrawTextFit(`Author: ${authorName}`, 150, 210, 700, "Black");
        DrawTextFit(`Duration: ${describeContractDuration(terms.durationMin)}${subject.kind === "signed" ? ` (${remainingText(subject.contract)})` : ""}`, 900, 210, 500, "Black");
        DrawTextFit(describeContractPolicy(terms.policy), 1430, 210, 420, "Black");
        if (subject.kind === "signed") {
            DrawTextFit(`Signed ${new Date(subject.contract.signedAt).toLocaleString()}`, 150, 255, 700, "Gray");
        }
        if (terms.terms.trim().length > 0) {
            DrawTextWrap(terms.terms.slice(0, 400), 150, 285, 1700, 120, "Black");
        }

        const specs = Object.entries(terms.rules).filter(([id, spec]) => spec.active && rules?.getDefinition(id));
        DrawText(`Rules (${specs.length}):`, 150, 450, "Black");
        const pageSpecs = specs.slice(this.rulePage * 4, this.rulePage * 4 + 4);
        pageSpecs.forEach(([id, spec], i) => {
            const definition = rules!.getDefinition(id)!;
            const y = 485 + i * 85;
            DrawTextFit(definition.name, 180, y + 25, 620, "Black");
            const settingsSummary = this.describeSettings(definition.settings ?? [], spec);
            DrawTextFit(
                `${spec.enforce ? "Enforced" : "Logged only"} - `
                + `${spec.useGlobal !== false && !spec.conditions ? "your global conditions" : describeConditions(spec.conditions)}`
                + (settingsSummary ? ` - ${settingsSummary}` : ""),
                180, y + 60, 1600, "Gray",
            );
        });
        const rulePages = Math.max(1, Math.ceil(specs.length / 4));
        this.rulePage = Math.min(this.rulePage, rulePages - 1);
        if (rulePages > 1) {
            MainCanvas.textAlign = "center";
            DrawBackNextButton(1530, 418, 250, 56, `Page ${this.rulePage + 1}/${rulePages}`, "White", "", () => "", () => "");
            this.addClickHandler(() => {
                if (MouseIn(1530, 418, 250, 56)) {
                    const direction = MouseX < 1530 + 125 ? -1 : 1;
                    this.rulePage = (this.rulePage + direction + rulePages) % rulePages;
                }
            });
            MainCanvas.textAlign = "left";
        }

        MainCanvas.textAlign = "center";
        if (subject.kind === "offer") {
            this.addClickHandler(ButtonActionWidget(
                { Left: 150, Top: 870, Width: 400, Height: 80 },
                { Name: "Sign the contract", HoverText: "Apply and seal every listed rule" },
                () => {
                    void modalConfirm(`Sign "${terms.title}"?\nEvery listed rule applies immediately and stays sealed `
                        + `until the contract ends (${describeContractDuration(terms.durationMin)}; ${describeContractPolicy(terms.policy).toLocaleLowerCase()}).`)
                        .then((confirmed) => {
                            if (!confirmed) {
                                return;
                            }
                            const result = this.contracts.sign(subject.payload);
                            if (result === true) {
                                this.Screen.exit();
                            } else {
                                BCPNotifyPlayer(`Cannot sign: ${result}.`);
                            }
                        });
                },
            ));
            this.addClickHandler(ButtonActionWidget(
                { Left: 600, Top: 870, Width: 300, Height: 80 },
                { Name: "Decline", HoverText: "Refuse this contract" },
                () => {
                    if (this.contracts.PendingOffer === subject.payload) {
                        this.contracts.declineOffer();
                    }
                    this.Screen.exit();
                },
            ));
        } else if (this.contracts.canReleaseLocally(subject.contract) && this.contracts.Signed[subject.contract.id]) {
            this.addClickHandler(ButtonActionWidget(
                { Left: 150, Top: 870, Width: 450, Height: 80 },
                { Name: "End the contract", HoverText: "Its policy allows either side to end it" },
                () => {
                    void modalConfirm(`End the contract "${subject.contract.title}"? Its rules return to how they were.`)
                        .then((confirmed) => {
                            if (confirmed) {
                                this.contracts.endContract(subject.contract.id, "released", Player.Nickname || Player.Name);
                                this.Screen.exit();
                            }
                        });
                },
            ));
        }
        MainCanvas.textAlign = "left";
    }

    /** Compact non-default settings summary for the review rows. */
    private describeSettings(declared: { name: string; label: string }[], spec: ContractRuleSpec): string {
        const parts: string[] = [];
        for (const setting of declared) {
            const value = spec.settings[setting.name];
            if (value === undefined || value === false || value === "" || (Array.isArray(value) && value.length === 0)) {
                continue;
            }
            const text = Array.isArray(value) ? value.join(", ") : String(value);
            parts.push(`${setting.label.replace(/:$/, "")}: ${text === "true" ? "yes" : text}`);
        }
        return parts.join("; ").slice(0, 220);
    }
}

/** Remote view: the contracts YOU authored on this person, with release. */
class RemoteContractsPage extends GUIPage {

    private removeListener: (() => void) | null = null;

    constructor(protected override readonly screen: ContractsScreen) {
        super(screen);
    }

    private get contracts(): Contracts {
        return this.screen.Module as Contracts;
    }

    get Config(): PageOptions {
        return {
            showTitle: true,
            showBack: true,
            showHelp: true,
            helpText: "Contracts you authored that currently bind this person - their client "
                + "answers only with contracts naming you as the author. Releasing is validated "
                + "on their side; contracts with the either-party policy can also be ended by them.",
        };
    }

    override async create(): Promise<void> {
        const member = this.Character!.MemberNumber;
        this.contracts.queryAuthored(member);
        this.removeListener = this.Core.Events.on("characterSyncReceived", ({ memberNumber }) => {
            if (memberNumber === member) {
                this.Screen.reopen();
            }
        });
    }

    override async destroy(): Promise<void> {
        this.removeListener?.();
        this.removeListener = null;
    }

    render(): void {
        const member = this.Character!.MemberNumber;
        const authored = this.contracts.authoredOn(member);
        MainCanvas.textAlign = "left";
        DrawText(`Contracts you authored on ${MemberNumberToName(member, `#${member}`)}:`, 150, 210, "Black");
        if (authored === undefined) {
            DrawText("Asking their client...", 180, 270, "Gray");
            return;
        }
        if (authored.length === 0) {
            DrawText("None - offer one from a draft on your own Contracts page.", 180, 270, "Gray");
            return;
        }
        authored.slice(0, 6).forEach((contract, i) => {
            const y = 250 + i * 90;
            DrawTextFit(`"${contract.title}"`, 180, y + 30, 700, "Black");
            DrawTextFit(
                `${Object.values(contract.rules).filter((r) => r.active).length} rules - ${remainingText(contract)} - ${describeContractPolicy(contract.policy)}`,
                180, y + 62, 1100, "Gray",
            );
            MainCanvas.textAlign = "center";
            this.addClickHandler(ButtonActionWidget(
                { Left: 1450, Top: y, Width: 300, Height: 70 },
                { Name: "Release", HoverText: "End this contract - their rules return to how they were" },
                () => this.contracts.requestRelease(member, contract.id),
            ));
            MainCanvas.textAlign = "left";
        });
    }
}
