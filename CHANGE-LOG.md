# BC+ Change Log

All notable changes to BC+ are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Scoped grants: a custom role's rules or curses grant can be limited to specific rules or specific slots ("Everything / N selected / None" in the grants editor). Members can then use the permission on exactly those items — commands touching anything else are rejected by the target's client.
- Custom roles: create your own roles ("Create role..." on the Roles screen) as flexible permission bundles — each grants exactly the permissions you tick to its members, on top of whatever their rank already allows. Grants are additive only: a custom role can never outrank BC Owner, take permissions away, or drop anyone below Public. Click a custom role's name in the table to configure its grants (requires `authority.edit`); creating/deleting/assigning requires `roles.manage`. Custom-role grants work remotely too — someone granted curse access through a custom role can manage your curses from their client.

### Changed
- Export/Import moved to one central hub in the main menu (own menu only): export or import rules, curses, or everything in one combined code. The scattered buttons on the Rules and Curses screens (which crowded the curses footer) are gone.
- Roles screen: all assignments now show in one paginated table (Role, ID, Name) — BC-derived entries (BC Owner, Lovers) are tagged "from BC", manual entries have a remove button, and adding uses a role selector with member input and Browse on the same screen. Editing now correctly requires the `roles.manage` permission.
- Main menu: hovering a module button now shows its description in a fixed panel on the right at normal, readable size, instead of BC's one-line tooltip that shrank long text into illegibility.

### Changed
- The top role is now **BC Owner**: it always reflects your actual in-game owner and can no longer be assigned manually. The Owner role below it remains the manual list for additional owners.
- The **Lover** role likewise follows your in-game loverships only and can no longer be assigned manually. Owner and Mistress remain the assignable roles.

### Fixed
- Changes to public data (role assignments, rule states, curses) are now broadcast to the room as they happen, so others' permission previews update immediately — previously granting someone access only took effect for them after a rejoin or manual sync.

### Added
- Release pipeline: every merge to main builds the official (signed) bundle and publishes it to GitHub Pages — the stable Tampermonkey loader at `https://seles84.github.io/bc-plus/bcplusLoader.user.js` is now live and always serves the latest release. Pull requests run typecheck, lint and the boot smoke test in CI.
- Commands module: one-shot orders executed on the target's client — Kneel, Stand up, Close/Open eyes, Set emoticon, and Forced say. Gated by the new `commands.use` permission (Mistress default); the target is notified who commanded what, and everything is logged. Forced speech is sanitized against command/emote/OOC injection.
- Conditions for rules and curses: each rule and curse can now be limited to public/private rooms, specific room names, while people of a chosen role are present or absent, while listed members are present or absent — and given a timer (15m–24h) that deactivates it or lifts it entirely when it runs out. All requirements must hold together; a rule/curse with unmet conditions simply pauses without losing its configuration. Conditions are editable remotely under the same permissions as the rule/curse itself.
- Speech pack 2 (8 new rules, 15 total): Doll talk (word/length limits), Replace spoken words (word:replacement pairs), Mandatory words, Restrained speech (allowed phrases only), Enforce faltering speech (st-st-stuttering), Block OOC while gagged, Order to greet the room, and Farewell on leave. In-character/OOC text is distinguished throughout — transforms and checks leave OOC text alone (except the gagged-OOC rule, which exists to block it).
- Play presets (General settings): **Dominant** (BC+ rules, curses and logging never apply to you — local and remote attempts are refused), **Switch**/**Submissive** (everything available), **Slave** (removes your own access to change your rules, curses and permissions, after a confirmation). Leaving Slave does not restore self-access — that stays in the hands of whoever holds authority over you.
- Export/Import: rules configurations and curse loadouts can be copied as shareable `BCP1:` codes and imported (validated and merged) — on the Rules and Curses screens.
- Local settings screens now honor a module's own edit permission (a Slave-preset player cannot reopen Authority to unlock themselves).
- Remote curse management: people with the `curses.edit` permission can curse slots, lift curses, toggle/configure them, and manage allowed items on another BC+ user — every command validated and applied by the target's client (item captures happen against the target's own appearance).
- Remote permission editing: the Authority screen works on other BC+ users for holders of `authority.edit`, via the same validated command path.
- Remote log requests now time out after 10 seconds with a clear failure message instead of showing "Requesting log..." forever; log request handling is traced in dev builds.
- Rule breach announcements: violations and blocked attempts are announced to the room as an action message (e.g. "Seles tried to use OOC in a message, which a rule forbids."), with per-rule wording and a per-rule "Announce breaches in chat" toggle (on by default).
- Specific rule-change notifications: when someone changes your rules you now see exactly what happened ("activated", "stopped enforcing", "changed the settings of", ...), mirrored in the behavior log.
- Member picker: role assignment now has a "Browse..." option listing people from your BC relationships, the current room (respecting blindness settings), and your friend list — no more typing member numbers. The picker is reusable for future member-selection needs.
- Stage 10 text commands: `/bcp` in chat — `help`, `version`, `who` (BC+ users in the room), `rules`, `curses`, `log [count]` (respects the log-view permission), and `sync`. All output is shown only to you.
- Stage 9 behavior log: rule violations and blocked attempts, curse triggers, and remote rule changes are recorded (capped at 200 entries). In tandem mode, BCX rule triggers are logged too.
- Log screen: newest-first paged view with timestamps and categories; clearing requires the `log.delete` permission (Owner default), and viewing — including your own log — requires `log.view` (Mistress default, self allowed).
- Remote log viewing: the log is never broadcast; other BC+ users request it and your client only replies if they hold `log.view`.
- Stage 8 curses: curse item/clothing slots so only permitted items can be worn. Each cursed slot holds a list of allowed items with per-item rules — strict items restore their exact captured state (color, type, crafting), loose items only need to be the same item. Slots can additionally allow (or be cursed to stay) empty.
- Curse enforcement runs continuously with a per-slot cooldown; restorations notify the player and are announced on the event bus for the future Logging module.
- Curses screens: cursed-slot overview, slot browser for adding curses (captures current state), and per-slot configuration (active, allow-empty, per-item strict/remove, allow currently worn item). Edits gated on the new `curses.edit` permission (Mistress default).
- Stage 6b rules: Forbidden words (configurable comma-separated list), Forbid shouting (all-caps messages are quieted to lowercase when enforced), Forbid emotes, and Forbid leaving the room.
- Text settings: rules and modules can declare free-text settings, rendered as input fields with remote-edit support (committed on blur/close).
- Stage 7 remote settings: the BC+ button on other BC+ users' sheets now opens their menu when their settings grant you viewing permission.
- Remote rule management: view another player's rules from their synced data and change them (activate/enforce/log/settings) when permitted — every change is validated and applied by *their* client, which notifies them who changed what and confirms or rejects the request.
- Permission previews: your standing toward another player is estimated from their synced role assignments plus visible BC relationships, so the UI greys out what you can't do; the target remains the final authority.
- Stage 6a rules engine: rules restrict the player's behavior with per-rule active/enforce/log state and custom settings; hooks install when a rule activates and are removed cleanly when it deactivates.
- Rules screen: browsable rule list with status, per-rule configuration page (toggles + custom settings), all gated on the `rules.edit` permission (Mistress by default).
- First rules: Forbid whispering (with Lover-and-above exception), Forbid OOC messages, Forbid beep messages (plain beeps optionally allowed).
- Rule violations and blocked attempts are reported on the event bus, ready for the Logging module.
- Stage 5 roles & authority: seven-role hierarchy (Club Owner > Owner > Lover > Mistress > Whitelist > Friend > Public) combining BC relationships with manually assigned lists.
- Roles screen: one page per assignable role showing BC-derived members and manual assignments, with add/remove by member number.
- Authority module: modules register permissions; each becomes a configurable "lowest role allowed" + "allow on myself" pair with a central `hasPermission` check (blacklisted members always denied).
- Initial permissions: view BC+ settings (Friend), edit permission settings (Owner), manage role assignments (Owner).
- Modules can provide custom settings screens in the main menu.
- Stage 4 messaging & sync: hidden-message protocol (`Type: Hidden`, `Content: BCP`) for BC+-to-BC+ communication with a per-module listener registry.
- Presence handshake: BC+ announces itself (version + public module data) when joining a room or loading in one; other BC+ users reply directly.
- Other characters' BC+ version and public data are tracked; their information sheet now shows a BC+ badge with their version.
- Messaging utilities: send actions/emotes to the room or one character, local-only chat notifications, character lookup by number/name/nickname.
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
