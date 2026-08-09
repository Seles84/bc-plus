# BC+ Change Log

All notable changes to BC+ are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-08-09

### Added
- Sensory pack (4 rules, 36 total): **Sensory deprivation: Sound** and **Sight** (adjustable Light/Medium/Heavy impairment applied like items, stacking with what's worn), plus **Hearing whitelist** and **Seeing whitelist** — listed members are always understood/seen normally no matter how deprived the player is, with an option to understand whitelisted members even while they're gagged.
- Locks & keys pack (8 rules, 32 total): forbid using remotes / keys / lockpicks / locks, each in a "on self" and "on others" variant. While enforced, the relevant dialog buttons simply don't appear.

### Changed
- Commands screen: descriptions now wrap onto two lines instead of shrinking to fit one; the Set emoticon description is shortened (the full emoticon list was crowding the row).

### Fixed
- Conditions editor: the timer's "Ends in..." readout no longer runs under the help icon — it moved to the "When it ends" row.

## [0.2.0] - 2026-08-09

### Added
- Protection pack (7 new rules, 24 total): Forbid club owner changes, Forbid getting new lovers, Forbid breaking up with lovers, Forbid taking new submissives, Forbid disowning submissives, Prevent blacklisting (role-protected), and Prevent whitelisting (minimum role) — guarding relationships and lists against impulsive or coerced changes. The other side of each relationship can always still act.
- **Listen to my voice** — configured sentences appear to the player at random intervals as a voice only they can see; **Ready to be summoned** — allowed members can summon the player from anywhere in the club via beep, pulling them to the summoner's room after a delay.
- Rules can now own timers (cleared automatically on deactivation) — the framework piece behind Listen to my voice.
- Custom roles: create your own roles ("Create role..." on the Roles screen) as flexible permission bundles — each grants exactly the permissions you tick to its members, on top of whatever their rank already allows. Grants are additive only: a custom role can never outrank BC Owner, take permissions away, or drop anyone below Public. Custom-role grants work remotely too.
- Scoped grants: a custom role's rules or curses grant can be limited to specific rules or specific slots ("Everything / N selected / None" in the grants editor). Members can then use the permission on exactly those items — commands touching anything else are rejected by the target's client.

### Changed
- Export/Import moved to one central hub in the main menu (own menu only): export or import rules, curses, or everything in one combined code. The scattered buttons on the Rules and Curses screens are gone.
- Rules screen: compact two-column list (16 per page) with short status chips; hovering a rule shows its full description, status and conditions in a readable panel over the opposite column.
- Roles screen: all assignments now show in one paginated table (Role, ID, Name) — BC-derived entries are tagged "from BC", manual entries have a remove button, and adding uses a role selector with member input and Browse on the same screen. Editing now correctly requires the `roles.manage` permission.
- Main menu: hovering a module button now shows its description in a fixed panel on the right at normal, readable size, instead of BC's one-line tooltip.

### Fixed
- Button labels no longer overflow their buttons (they were anchored to the button midpoint under left text-alignment).

## [0.1.0] - 2026-08-08

### Added
- Release pipeline: every merge to main builds the official (signed) bundle and publishes it to GitHub Pages — the stable Tampermonkey loader at `https://seles84.github.io/bc-plus/bcplusLoader.user.js` is live and always serves the latest release. Pull requests run typecheck, lint and the boot smoke test in CI.
- Commands module: one-shot orders executed on the target's client — Kneel, Stand up, Close/Open eyes, Set emoticon, and Forced say. Gated by the new `commands.use` permission (Mistress default); the target is notified who commanded what, and everything is logged. Forced speech is sanitized against command/emote/OOC injection.
- Conditions for rules and curses: each rule and curse can be limited to public/private rooms, specific room names, while people of a chosen role are present or absent, while listed members are present or absent — and given a timer that deactivates it or lifts it entirely when it runs out. All requirements must hold together; a rule/curse with unmet conditions simply pauses without losing its configuration. Conditions are editable remotely under the same permissions as the rule/curse itself.
- Speech pack 2 (8 rules): Doll talk (word/length limits), Replace spoken words (word:replacement pairs), Mandatory words, Restrained speech (allowed phrases only), Enforce faltering speech (st-st-stuttering), Block OOC while gagged, Order to greet the room, and Farewell on leave. In-character/OOC text is distinguished throughout.
- Play presets (General settings): **Dominant** (BC+ rules, curses and logging never apply to you — local and remote attempts are refused), **Switch**/**Submissive** (everything available), **Slave** (removes your own access to change your rules, curses and permissions, after a confirmation). Leaving Slave does not restore self-access.
- Export/Import: rules configurations and curse loadouts can be copied as shareable `BCP1:` codes and imported (validated and merged).
- Local settings screens honor a module's own edit permission (a Slave-preset player cannot reopen Authority to unlock themselves).
- Remote curse management: people with the `curses.edit` permission can curse slots, lift curses, toggle/configure them, and manage allowed items on another BC+ user — every command validated and applied by the target's client.
- Remote permission editing: the Authority screen works on other BC+ users for holders of `authority.edit`.
- Remote log requests time out after 10 seconds with a clear failure message; log request handling is traced in dev builds.
- Rule breach announcements: violations and blocked attempts are announced to the room as an action message, with per-rule wording and a per-rule "Announce breaches in chat" toggle (on by default).
- Specific rule-change notifications: when someone changes your rules you see exactly what happened, mirrored in the behavior log.
- Member picker: role assignment has a "Browse..." option listing people from your BC relationships, the current room (respecting blindness settings), and your friend list.
- Text commands: `/bcp` in chat — `help`, `version`, `who`, `rules`, `curses`, `log [count]`, `sync`, and `debug`. All output is shown only to you.
- Behavior log: rule violations and blocked attempts, curse triggers, and remote rule changes are recorded (capped at 200 entries). In tandem mode, BCX rule triggers are logged too. Newest-first paged view; clearing requires `log.delete` (Owner default), viewing — including your own log — requires `log.view` (Mistress default, self allowed). The log is never broadcast; other BC+ users request it and your client only replies if they hold `log.view`.
- Curses: curse item/clothing slots so only permitted items can be worn. Each cursed slot holds a list of allowed items with per-item rules — strict items restore their exact captured state, loose items only need to be the same item. Slots can additionally allow (or be cursed to stay) empty. Continuous enforcement with anti-fight-loop cooldowns, room announcements for restored/removed items, and a grouped slot picker (Items/Clothing). Edits gated on `curses.edit` (Mistress default).
- Rules engine (9 rules at release): per-rule active/enforce/log state and custom settings; hooks install when a rule activates and are removed cleanly when it deactivates. Rules: Forbid whispering, Forbid OOC, Forbidden words, Forbid shouting, Forbid emotes, Forbid beep messages, Forbid leaving. Gated on `rules.edit` (Mistress default).
- Remote settings: the BC+ button on other BC+ users' sheets opens their menu when their settings grant you viewing permission. Remote rule management with target-side validation — the target's client confirms or rejects every change and notifies its player.
- Roles & authority: role hierarchy (BC Owner > Owner > Lover > Mistress > Whitelist > Friend > Public) combining BC relationships with manually assigned lists; permission registry with per-permission "lowest role allowed" + "allow on myself" settings and a central `hasPermission` check (blacklisted members always denied).
- Messaging & sync: hidden-message protocol for BC+-to-BC+ communication, presence handshake with version and public data, BC+ badge on other users' information sheets.
- GUI framework: BC+ button on the information sheet (repositioned in tandem mode), canvas-rendered screens with standard chrome, auto-generated per-module settings screens, main menu.
- Storage: save-file manager on `Player.ExtensionSettings` with localStorage backup and recovery, deep-proxy auto-sync with integrity checks, signed save format, per-module persistent data, update notifications.
- Core framework: per-module hook tracking, module lifecycle with error isolation, typed event bus, BCX detection (tandem/control mode).
- Toolchain: esbuild pipeline, strict TypeScript with `bc-stubs`, Tampermonkey loaders (stable + localhost dev), ESLint, Node boot smoke test.

### Changed
- The top role is **BC Owner**: it always reflects your actual in-game owner and cannot be assigned manually. The **Lover** role likewise follows your in-game loverships only. Owner and Mistress are the assignable ranks.

### Fixed
- Changes to public data (role assignments, rule states, curses) are broadcast to the room as they happen, so others' permission previews update immediately.
