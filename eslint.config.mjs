import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
    {
        ignores: [
            "dist/",
            "node_modules/",
            "static-stable/",
            "static-dev/",
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ["build.mjs", "eslint.config.mjs"],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            globals: {
                ...globals.browser,
            },
        },
        rules: {
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
        },
    },
);
