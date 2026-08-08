// Boot smoke test: evaluates the built bundle outside BC with minimal stubs.
// Catches module-evaluation regressions (import cycles, SDK interop) that
// typecheck/lint cannot see. Expected outcome: the bundle constructs BCPlus
// and fails no earlier than hooking BC functions that only exist in the club.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.alert = (message) => console.log("ALERT:", message);

let failed = false;
try {
    require("../dist/bcplus.js");
    console.log("SMOKE OK: bundle evaluated and BCPlus constructed");
} catch (e) {
    failed = true;
    console.error("SMOKE FAILED during bundle evaluation:", e);
}

process.exit(failed ? 1 : 0);
