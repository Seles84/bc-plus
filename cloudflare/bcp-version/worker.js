/**
 * BC+ version endpoint.
 *
 * Serves the release manifest (proxied from GitHub Pages, which stays the
 * single source of truth) and counts each request in Workers Analytics
 * Engine. A datapoint holds the BC+ version being run, the kind of check
 * (login / relog / interval / dev), the request's country and browser
 * family, and two rotating anonymous visitor hashes used to count daily
 * and weekly unique users. Each hash is SHA-256 of a secret salt, the
 * current UTC date (or ISO week) and the client IP - it cannot be
 * reversed and rotates with its period, so visitors cannot be tracked
 * across days or weeks. No member number, no account data, and no IP is
 * ever stored by this worker.
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

/** Current UTC date as an ISO year-week label, e.g. "2026-W35". */
function isoWeek(now) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
    const week = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** 64-bit hex digest of salt:period:ip - a rotating unique-visitor marker. */
async function visitorHash(ip, salt, period) {
    const data = new TextEncoder().encode(`${salt}:${period}:${ip}`);
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
            const salted = ip !== "" && typeof env.PING_SALT === "string" && env.PING_SALT !== "";
            const now = new Date();
            const daily = salted ? await visitorHash(ip, env.PING_SALT, now.toISOString().slice(0, 10)) : "";
            const weekly = salted ? await visitorHash(ip, env.PING_SALT, isoWeek(now)) : "";
            env.PINGS?.writeDataPoint({
                blobs: [version, kind, country, browser, daily, weekly],
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
