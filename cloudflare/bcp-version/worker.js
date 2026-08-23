/**
 * BC+ version endpoint.
 *
 * Serves the release manifest (proxied from GitHub Pages, which stays the
 * single source of truth) and counts each request in Workers Analytics
 * Engine. The datapoint holds only what the query string carries: the BC+
 * version being run and the kind of check (login / interval / dev). No
 * member number, no account data, and no IP is ever stored by this worker.
 */

const UPSTREAM = "https://seles84.github.io/bc-plus/version.json";

const HEADERS = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
};

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname !== "/" && url.pathname !== "/version.json") {
            return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: HEADERS });
        }

        const version = (url.searchParams.get("v") ?? "").slice(0, 32);
        const kindRaw = url.searchParams.get("t") ?? "";
        const kind = ["login", "interval", "dev"].includes(kindRaw) ? kindRaw : "other";
        try {
            env.PINGS?.writeDataPoint({
                blobs: [version, kind],
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
