import { BCPLUS_SHORT_NAME } from "@/system/Constants";

const STYLES = {
    INFO: "color: #32CCCC",
    LOG: "color: #CCCC32",
    DEBUG: "color: #9E4BCF",
} as const;

function emit(method: "info" | "log" | "warn" | "error" | "debug", style: string, args: unknown[]): void {
    if (typeof args[0] === "string") {
        console[method](`%c${BCPLUS_SHORT_NAME}: ${args[0]}`, style, ...args.slice(1));
    } else {
        console[method](`%c${BCPLUS_SHORT_NAME}:`, style, ...args);
    }
}

export function info(...args: unknown[]): void {
    emit("info", STYLES.INFO, args);
}

export function log(...args: unknown[]): void {
    emit("log", STYLES.LOG, args);
}

export function warn(...args: unknown[]): void {
    emit("warn", STYLES.LOG, args);
}

export function err(...args: unknown[]): void {
    emit("error", STYLES.LOG, args);
}

export function debug(...args: unknown[]): void {
    if (BCP_DEV_ENV) {
        // console.log, not console.debug: Chrome hides the Verbose level by
        // default and dev traces must be visible without DevTools tweaking
        emit("log", STYLES.DEBUG, args);
    }
}

