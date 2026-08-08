# BC+ Change Log

All notable changes to BC+ are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Stage 3 GUI framework: BC+ button on the information sheet (repositioned in tandem mode to avoid BCX's button) opening a canvas-rendered main menu.
- Screen/page system with standard chrome (title, back button, help overlay, multi-page navigation) and immediate-mode click regions.
- Auto-generated per-module settings screens driven by each module's `Settings` declaration (checkbox and option widgets), persisted via module data.
- Main menu lists all modules with a GUI, shows player/version/mode status, and links to the changelog.
- Core module setting: toggle for post-update notifications.
- Dev/serve builds copy the dev loader to `dist/`, so it can be installed directly from `http://localhost:3045/bcplusLoader.user.js`; stable builds stage the stable loader for Pages deployment.
- Stage 2 storage: save-file manager persisting to `Player.ExtensionSettings` (server-synced) or localStorage, with an always-written localStorage backup and recovery prompt.
- Auto-sync: module data is exposed through a deep proxy; any mutation schedules a debounced save with a round-trip integrity check.
- Save format `1:<lzstring-base64>:<hmac>` compatible with the original design; official builds sign saves with `BCP_SAVE_KEY` (Web Crypto HMAC-SHA256, no crypto dependency), unofficial builds mark saves with `-`.
- Per-module persistent data: modules declare `Defaults` and read/write `this.Data`; new default keys merge into existing saves.
- Storage utilities: wipe-all-data with member-number confirmation, storage-location switching, first-boot initialization.
- Update detection: after an update, BC+ shows a changelog notification and stamps the save with the new version.
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
