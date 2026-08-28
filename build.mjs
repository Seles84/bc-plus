import * as esbuild from "esbuild";
import Vue from "unplugin-vue/esbuild";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// Load .env (KEY=VALUE lines) without a dotenv dependency; real env vars win.
let envFile = "";
try {
    envFile = readFileSync(new URL("./.env", import.meta.url), "utf8");
} catch {
    // no .env present - fine
}
for (const line of envFile.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2];
    }
}

const args = process.argv.slice(2);
const serve = args.includes("--serve");
const dev = serve || args.includes("--dev");

const SERVE_PORT = 3045;

/**
 * Compiles the Tailwind stylesheet for the DOM UI into src/ui/generated/
 * (git-ignored; imported into the bundle as text and injected into the
 * window's shadow root). Only writes on change, so watch mode does not
 * rebuild in a loop. Preflight is deliberately not imported - its reset
 * would restyle the whole club page.
 */
function buildTailwind() {
    const input = fileURLToPath(new URL("./src/ui/app.css", import.meta.url));
    const output = fileURLToPath(new URL("./src/ui/generated/tailwind.css", import.meta.url));
    const cli = fileURLToPath(new URL("./node_modules/@tailwindcss/cli/dist/index.mjs", import.meta.url));
    mkdirSync(new URL("./src/ui/generated/", import.meta.url), { recursive: true });
    const result = spawnSync(process.execPath, [cli, "-i", input, "-o", `${output}.tmp`, ...(dev ? [] : ["--minify"])], {
        stdio: ["ignore", "ignore", "inherit"],
    });
    if (result.status !== 0) {
        throw new Error(`Tailwind build failed (exit ${result.status})`);
    }
    const fresh = readFileSync(`${output}.tmp`, "utf8");
    if (!existsSync(output) || readFileSync(output, "utf8") !== fresh) {
        writeFileSync(output, fresh);
    }
}
buildTailwind();

/** @type {esbuild.BuildOptions} */
const options = {
    entryPoints: ["src/index.ts"],
    outfile: "dist/bcplus.js",
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: !dev,
    sourcemap: dev ? "inline" : false,
    loader: {
        ".png": "dataurl",
        // Stylesheets ship as strings and are injected into the UI shadow root
        ".css": "text",
    },
    plugins: [
        Vue({ isProduction: !dev }),
        {
            name: "bcp-tailwind",
            setup(build) {
                let first = true;
                build.onStart(() => {
                    // Initial CSS was built at script start; regenerate on
                    // watch rebuilds so new utility classes appear
                    if (first) {
                        first = false;
                        return;
                    }
                    buildTailwind();
                });
            },
        },
    ],
    define: {
        BCP_VERSION: JSON.stringify(dev ? pkg.displayVersion : pkg.version),
        BCP_DEV_ENV: JSON.stringify(dev),
        BCP_STABLE: JSON.stringify(!dev),
        BCP_SAVE_KEY: JSON.stringify(process.env.BCP_SAVE_KEY ?? ""),
        "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production"),
        __VUE_OPTIONS_API__: "false",
        __VUE_PROD_DEVTOOLS__: "false",
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
    },
    logLevel: "info",
};

// Ship the matching loader userscript next to the bundle: in dev/serve it can be
// installed straight from http://localhost:3045/bcplusLoader.user.js (Tampermonkey
// offers installation when a .user.js URL is opened); in stable builds it lands in
// dist/ ready for the Pages deployment.
mkdirSync("dist", { recursive: true });
copyFileSync(
    dev ? "static-dev/bcplusLoader.user.js" : "static-stable/bcplusLoader.user.js",
    "dist/bcplusLoader.user.js",
);

// Version manifest - clients fetch this from the Pages deploy to learn the
// latest released version (always pkg.version; displayVersion is dev-only)
writeFileSync("dist/version.json", JSON.stringify({ version: pkg.version }) + "\n");

// One-click launcher for the landing page: injects the bundle into the club
// tab on demand, same as the loader userscript but without an extension.
// Single-quoted strings only - it is interpolated into an HTML attribute.
const bookmarklet = "javascript:(()=>{if(window.BCPlus===undefined)"
    + "{var n=document.createElement('script');"
    + "n.setAttribute('crossorigin','anonymous');"
    + "n.src='https://seles84.github.io/bc-plus/bcplus.js?_='+Date.now();"
    + "n.onload=()=>n.remove();document.head.appendChild(n);}})();";

// Landing page for GitHub Pages (the deploy serves dist/ as the site root)
writeFileSync("dist/index.html", `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BC+ (Bondage Club Plus)</title>
<style>
    body { background: #1a1520; color: #e8e2f0; font-family: system-ui, sans-serif;
           max-width: 720px; margin: 3rem auto; padding: 0 1.5rem; line-height: 1.6; }
    h1 { color: #b794e6; }
    a { color: #b794e6; }
    code { background: #2a2135; padding: 2px 6px; border-radius: 4px; }
    code.wrap { display: block; padding: 8px 10px; word-break: break-all;
                font-size: 0.8rem; user-select: all; }
    .card { background: #241c2e; border-left: 4px solid #8469b6; border-radius: 6px;
            padding: 1rem 1.25rem; margin: 1.5rem 0; }
    .version { color: #9a8fb0; font-size: 0.9rem; }
</style>
</head>
<body>
<h1>BC+ (Bondage Club Plus)</h1>
<p class="version">Version ${pkg.version}</p>
<p>An extension for the web game <em>Bondage Club</em>: rules, curses, custom roles with
fine-grained permissions, conditions and timers, one-shot commands, presets, and a behavior log.
Runs standalone or in tandem with BCX.</p>
<div class="card">
    <strong>Install (recommended)</strong>
    <ol>
        <li>Install a userscript manager such as <a href="https://www.tampermonkey.net/">Tampermonkey</a>.</li>
        <li>Open <a href="bcplusLoader.user.js">the BC+ loader</a> and confirm the installation.</li>
        <li>Open the club &mdash; BC+ loads automatically and updates itself on every visit.</li>
    </ol>
</div>
<div class="card">
    <strong>Or launch via bookmark</strong>
    <p>No extension needed: drag this link onto your bookmarks bar &mdash;
    <a href="${bookmarklet}">Launch BC+</a> &mdash; then click the bookmark in the
    club tab whenever you want BC+ (before or after logging in). It loads the
    current version each time, but only for that session &mdash; the userscript
    above is the set-and-forget option.</p>
    <p>If dragging does not work, create a bookmark by hand and paste this as its address:</p>
    <p><code class="wrap">${bookmarklet}</code></p>
</div>
<p><a href="https://github.com/Seles84/bc-plus">Source on GitHub</a> &middot;
<a href="https://github.com/Seles84/bc-plus/blob/main/CHANGE-LOG.md">Changelog</a></p>
</body>
</html>
`);

if (serve) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    const { port } = await ctx.serve({
        servedir: "dist",
        port: SERVE_PORT,
        host: "127.0.0.1",
        // Lets the dev loader use crossorigin="anonymous", so BC+ errors
        // surface with full stack traces instead of opaque "Script error."
        cors: { origin: "*" },
    });
    console.log(`BC+ dev server running: http://localhost:${port}/bcplus.js`);
} else {
    await esbuild.build(options);
    console.log(`BC+ ${dev ? pkg.displayVersion : pkg.version} built -> dist/bcplus.js`);
}
