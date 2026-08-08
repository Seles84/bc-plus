import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";

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
    },
    define: {
        BCP_VERSION: JSON.stringify(dev ? pkg.displayVersion : pkg.version),
        BCP_DEV_ENV: JSON.stringify(dev),
        BCP_STABLE: JSON.stringify(!dev),
        BCP_SAVE_KEY: JSON.stringify(process.env.BCP_SAVE_KEY ?? ""),
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

if (serve) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    const { port } = await ctx.serve({
        servedir: "dist",
        port: SERVE_PORT,
        host: "127.0.0.1",
    });
    console.log(`BC+ dev server running: http://localhost:${port}/bcplus.js`);
} else {
    await esbuild.build(options);
    console.log(`BC+ ${dev ? pkg.displayVersion : pkg.version} built -> dist/bcplus.js`);
}
