import * as esbuild from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

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
    define: {
        BCP_VERSION: JSON.stringify(dev ? pkg.displayVersion : pkg.version),
        BCP_DEV_ENV: JSON.stringify(dev),
        BCP_STABLE: JSON.stringify(!dev),
    },
    logLevel: "info",
};

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
