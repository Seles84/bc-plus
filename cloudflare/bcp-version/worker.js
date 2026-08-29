/**
 * BC+ version endpoint.
 *
 * Serves the release manifest (proxied from GitHub Pages, which stays the
 * single source of truth) and counts each request in Workers Analytics
 * Engine. A datapoint holds the BC+ version being run, the kind of check
 * (login / relog / interval / dev), the request's country and browser
 * family, and a daily-rotating anonymous visitor hash used to count daily
 * unique users. The hash is SHA-256 of a secret salt, the current UTC date
 * and the client IP - it cannot be reversed and changes every day, so
 * visitors cannot be tracked across days. No member number, no account
 * data, and no IP is ever stored by this worker.
 */

const UPSTREAM = "https://seles84.github.io/bc-plus/version.json";

const HEADERS = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
};

/** Coarse browser family from the user-agent; never the full UA string. */
function browserFamily(ua) {
    if (ua.includes("Firefox/")) return "firefox";
    if (ua.includes("Edg/")) return "edge";
    if (ua.includes("OPR/")) return "opera";
    if (ua.includes("Chrome/")) return "chrome";
    if (ua.includes("Safari/")) return "safari";
    return ua === "" ? "" : "other";
}

/** 64-bit hex digest of salt:day:ip - the daily-unique visitor marker. */
async function dailyVisitorHash(ip, salt) {
    const day = new Date().toISOString().slice(0, 10);
    const data = new TextEncoder().encode(`${salt}:${day}:${ip}`);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest).slice(0, 8)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname !== "/" && url.pathname !== "/version.json") {
            return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: HEADERS });
        }

        const version = (url.searchParams.get("v") ?? "").slice(0, 32);
        const kindRaw = url.searchParams.get("t") ?? "";
        const kind = ["login", "relog", "interval", "dev"].includes(kindRaw) ? kindRaw : "other";
        try {
            const country = typeof request.cf?.country === "string" ? request.cf.country : "";
            const browser = browserFamily(request.headers.get("user-agent") ?? "");
            // Without the salt secret no hash is written - a raw or weakly
            // hashed IP must never land in the dataset
            const ip = request.headers.get("cf-connecting-ip") ?? "";
            const visitor = ip !== "" && typeof env.PING_SALT === "string" && env.PING_SALT !== ""
                ? await dailyVisitorHash(ip, env.PING_SALT)
                : "";
            env.PINGS?.writeDataPoint({
                blobs: [version, kind, country, browser, visitor],
                doubles: [1],
            });
        } catch {
            // Counting must never break the version check
        }

        try {
            const upstream = await fetch(UPSTREAM, { cf: { cacheTtl: 60, cacheEverything: true } });
            if (!upstream.ok) {
                return new Response(JSON.stringify({ error: `upstream ${upstream.status}` }), { status: 502, headers: HEADERS });
            }
            return new Response(await upstream.text(), { status: 200, headers: HEADERS });
        } catch {
            return new Response(JSON.stringify({ error: "upstream unreachable" }), { status: 502, headers: HEADERS });
        }
    },
};
