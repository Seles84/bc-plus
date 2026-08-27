import { ConditionData, sanitizeConditions } from "@/system/conditions/Conditions";
import { RuleStateData } from "@/system/rules/RuleTypes";

/**
 * Contracts are dom-side authored bundles of rule state that only take
 * effect after the target countersigns. Drafts live in the author's own
 * BC+ (private data); a signed contract lives on the signer's client,
 * which is - as always - the sole validator.
 */

/** One rule as a contract wants it configured on the signer. */
export interface ContractRuleSpec {
    /** Specs toggled inactive in the draft are skipped at signing */
    active: boolean;
    enforce: boolean;
    log: boolean;
    announce: boolean;
    /** Follow the signer's global conditions instead of `conditions` */
    useGlobal?: boolean;
    settings: Record<string, unknown>;
    /** Timers are stripped at signing - the contract's own duration rules */
    conditions?: ConditionData;
}

/** Who may end the contract before it expires. */
export type ContractPolicy = "author" | "either";

/** The shared body of drafts, offers and signed records. */
export interface ContractTerms {
    title: string;
    /** Free-text terms shown on the review screen */
    terms: string;
    /** Minutes until expiry; 0 = open-ended (release only) */
    durationMin: number;
    policy: ContractPolicy;
    rules: Record<string, ContractRuleSpec>;
}

/** A draft in the author's library. */
export interface ContractDraft extends ContractTerms {
    id: string;
}

/** What travels in an offer code/message. Authorship is claimed, not proven -
 *  the review screen shows it and the signer decides whom they trust. */
export interface ContractPayload extends ContractTerms {
    author: number;
    authorName: string;
}

/** A countersigned contract on the signer's client. */
export interface SignedContract extends ContractTerms {
    id: string;
    author: number;
    authorName: string;
    signedAt: number;
    /** Unix ms expiry; null = open-ended */
    until: number | null;
    /** Pre-signing state of every touched rule, restored when the contract ends */
    prior: Record<string, RuleStateData>;
}

export const MAX_CONTRACT_RULES = 30;
export const MAX_ACTIVE_CONTRACTS = 3;
export const MAX_DRAFTS = 20;
/** 30 days */
export const MAX_DURATION_MIN = 43_200;

const MAX_SPEC_SETTINGS = 32;
const MAX_SETTING_STRING = 1000;
const MAX_SETTING_LIST = 100;

/**
 * Rule settings are only ever booleans, strings, numbers, member lists or
 * string lists. Anything else in an untrusted payload is dropped, and sizes
 * are capped - a signed contract persists into the signer's auto-synced
 * save, so a crafted offer must not be able to smuggle a large blob in.
 */
function sanitizeSpecSettings(raw: Record<string, unknown>): Record<string, unknown> {
    const settings: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
        if (Object.keys(settings).length >= MAX_SPEC_SETTINGS) {
            break;
        }
        if (key.length > 60) {
            continue;
        }
        if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
            settings[key] = value;
        } else if (typeof value === "string") {
            settings[key] = value.slice(0, MAX_SETTING_STRING);
        } else if (Array.isArray(value)) {
            settings[key] = value
                .slice(0, MAX_SETTING_LIST)
                .filter((v) => typeof v === "string" || (typeof v === "number" && Number.isInteger(v)))
                .map((v) => (typeof v === "string" ? v.slice(0, 200) : v));
        }
    }
    return settings;
}

function sanitizeSpec(raw: unknown): ContractRuleSpec | null {
    if (typeof raw !== "object" || raw === null) {
        return null;
    }
    const spec = raw as Partial<ContractRuleSpec>;
    if (typeof spec.settings !== "object" || spec.settings === null) {
        return null;
    }
    const result: ContractRuleSpec = {
        active: spec.active === true,
        enforce: spec.enforce !== false,
        log: spec.log !== false,
        announce: spec.announce !== false,
        settings: sanitizeSpecSettings(spec.settings as Record<string, unknown>),
    };
    if (typeof spec.useGlobal === "boolean") {
        result.useGlobal = spec.useGlobal;
    }
    if (spec.conditions !== undefined) {
        const conditions = sanitizeConditions(spec.conditions);
        if (conditions && Object.keys(conditions).length > 0) {
            // A timer inside a rule condition would fight the deactivation
            // guard on bound rules - the contract's duration is the timer
            delete conditions.timerEnd;
            delete conditions.timerAction;
            result.conditions = conditions;
        }
    }
    return result;
}

/** Validates an untrusted contract payload (offer message or pasted code). */
export function sanitizeContractPayload(raw: unknown): ContractPayload | null {
    if (typeof raw !== "object" || raw === null) {
        return null;
    }
    const payload = raw as Partial<ContractPayload>;
    if (typeof payload.title !== "string" || payload.title.trim().length === 0
        || typeof payload.author !== "number" || !Number.isInteger(payload.author) || payload.author < 0
        || typeof payload.rules !== "object" || payload.rules === null) {
        return null;
    }
    const rules: Record<string, ContractRuleSpec> = {};
    for (const [id, rawSpec] of Object.entries(payload.rules).slice(0, MAX_CONTRACT_RULES)) {
        if (typeof id !== "string" || id.length > 60) {
            continue;
        }
        const spec = sanitizeSpec(rawSpec);
        if (spec) {
            rules[id] = spec;
        }
    }
    const durationMin = Number.isInteger(payload.durationMin)
        ? Math.min(Math.max(payload.durationMin as number, 0), MAX_DURATION_MIN)
        : 0;
    return {
        title: payload.title.trim().slice(0, 60),
        terms: typeof payload.terms === "string" ? payload.terms.slice(0, 1000) : "",
        durationMin,
        policy: payload.policy === "either" ? "either" : "author",
        rules,
        author: payload.author,
        authorName: typeof payload.authorName === "string" ? payload.authorName.slice(0, 40) : `#${payload.author}`,
    };
}

export function describeContractDuration(durationMin: number): string {
    if (durationMin <= 0) {
        return "until released";
    }
    if (durationMin < 60) {
        return `${durationMin} min`;
    }
    if (durationMin < 24 * 60) {
        const hours = Math.floor(durationMin / 60);
        const minutes = durationMin % 60;
        return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
    }
    const days = Math.floor(durationMin / (24 * 60));
    const hours = Math.floor((durationMin % (24 * 60)) / 60);
    return hours === 0 ? `${days} d` : `${days} d ${hours} h`;
}

export function describeContractPolicy(policy: ContractPolicy): string {
    return policy === "either"
        ? "Either side may end it"
        : "Only the author may end it early";
}
