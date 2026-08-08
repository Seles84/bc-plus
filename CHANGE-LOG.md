# BC+ Change Log

All notable changes to BC+ are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Stage 1 core framework: per-module hook tracking in the SDK wrapper (hooks are owned by a module slug and removed on unload), `patchFunction`, and `awaitChatRoom`.
- Module system: `ModuleInstance` base class with Init/Load/Unload/Reload lifecycle, `ModuleManager` orchestration with per-module error isolation.
- Typed internal event bus (`modeChanged`, `moduleLoaded`, `modulesLoaded`, `moduleUnloaded`).
- BCX detection at login: runs in `tandem` mode when BCX is present (with typed access to the BCX mod API) or `control` mode standalone.
- Core module announcing readiness and run mode in-club.
- Stage 0 scaffold: esbuild build pipeline producing `dist/bcplus.js` (production, dev, and watch+serve modes on port 3045).
- Strict TypeScript setup with `bc-stubs` (R131) game typings and `@/*` path aliases.
- Core boot: ModSDK registration, login detection, styled console logging, version parsing, and an in-club "Ready" notification.
- Tampermonkey loaders: `static-stable/bcplusLoader.user.js` (GitHub Pages) and `static-dev/bcplusLoader.user.js` (localhost).
- ESLint (flat config) with typescript-eslint.
