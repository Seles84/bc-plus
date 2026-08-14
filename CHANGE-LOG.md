# BC+ Change Log

All notable changes to BC+ are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- BC+ now remembers the name and nickname of everyone you encounter (room members, and anyone you pick in a member browser), so members referenced in roles, rules or relationships show their actual name even while offline instead of "Unknown" or a bare number. The cache holds the 300 most recently seen people, is stored privately (never shared with other players), and heals existing "Unknown" entries the next time that person is in a room with you.
- Member settings on rules ("Members who may summon", the hearing/seeing whitelists) are now a browse-and-pick screen instead of a comma-number text field: a "N selected" button opens the same member browser Roles uses (relationships, current room, friends — with checkboxes), plus a field to add any member number directly. Old comma-string values keep working and remain understood from older clients.
- Multi-entry rule settings (Forbidden/Required words, Replace spoken words, Restrained speech phrases, Listen-to-my-voice sentences, allowed room names) now open a row editor: each entry on its own line with a remove button, plus an add button — no more comma or | separators. Old separated values keep working.
- Global rule conditions: a shared conditions set (room type, room names, roles, members — no timer) edited via the "Global conditions" button on the Rules screen. Every rule has a "Follow global conditions" checkbox on its config page — newly added rules follow the global set by default, existing rules keep their own conditions. Editing the global set immediately affects every rule following it, locally and remotely (changing it remotely requires unscoped rule-edit permission, since it touches all following rules).

### Changed
- The Rules screen has been redesigned around active rules only, instead of paging through the whole catalog. A new "Add rule" button opens the full catalog with a search field and per-category filter buttons — picking a rule activates it and opens its configuration. The active list can be grouped by category (with headers) or arranged in your own order (Sort button toggles; in Custom mode every row gets up/down arrows). "Enable all" / "Disable all" buttons flip enforcement on every active rule at once without touching their configuration. Status chips now read Enforced/Paused (or BCX when deferred), and your sort preference and order sync so remote viewers see your rules the way you arranged them.

### Fixed
- In tandem mode, the behavior log no longer mirrors BCX rule triggers that BCX itself would not log. BCX's setting-enforcement rules (e.g. forcing the safeword setting) announce a trigger every time they snap a BC setting back — on every login — which flooded the log with entries BCX's own log never shows. BC+ now applies the same gate BCX does (the rule's log toggle plus whether it has log text at all), and logged BCX triggers show the rule's display name instead of its internal id.
- "Forbid leaving the room" now also hooks BC's official leave-permission check, so the exit button properly disables and leave commands added by other mods (e.g. /leave) are blocked too. Forced moves — leashes, kicks, cell/GGTS transfers and BC's safeword release — intentionally still work.

### Added
- Room control rules (new "Rooms" category, 44 rules total): **Forbid creating new rooms** (blocks the room creation screen; editing rooms the player already administrates still works), **Restrict entering rooms** (only rooms on a configurable name list can be joined — inactive while the list is empty as a safety measure; BC+ summons and go-to-room commands are exempt), and **Forbid room admin UI while blind** (the admin button grays out while the player cannot see, keeping the background and admin numbers hidden; admin chat commands still work). All three defer to their BCX equivalents in tandem mode.

## [0.5.0] - 2026-08-12

### Added
- Tandem mode now actually defers to BCX instead of doubling up. Almost every BC+ rule is mapped to its BCX equivalent; while BCX's version of a rule is in effect on your client, the BC+ rule pauses automatically — the rules list shows an amber "BCX" chip and the config page explains the pause. The check is live: toggling the rule in BCX immediately hands control back and forth. BC+ curses similarly yield when a BCX curse acts on the same item slot (notified once, logged, retried after five minutes so a lifted BCX curse hands the slot back). A "Defer to BCX in tandem mode" checkbox on the General page (only shown when BCX is present, on by default) turns all of this off if you truly want both mods enforcing.
- Bondage rules batch (6 new rules in the Items category, 41 total): **Forbid tying up self** and **Forbid tying up others** disable using items in the item dialog — the item buttons gray out with the rule named as the reason. The others-variant can be limited to characters more dominant than the player (on by default). **Forbid freeing self** and **Forbid freeing others** hide the Remove/Struggle/Dismount/Escape buttons, with an option to still allow removing low-difficulty items (hand-held toys, plushies...). **Forbid wardrobe use on self** and **Forbid wardrobe use on others** block changing clothes entirely (others can still dress the player).

### Changed
- Update notifications now arrive as boxed [BC+] chat messages in BC+'s purple style (like EBC's): an update-available notice tells you the new and current version, to reload for it, and how to silence it; the after-update notice links the change log. Outside a room you get the old corner beep and the chat lines wait for your next room join. New command `/bcp updates on|off` toggles them (same switch as the General-page checkbox).

### Fixed
- Command rows on the Commands screen now take as much vertical space as their description needs, so long ones (e.g. "Write lines") no longer overflow into the next command. The "Whisper commands" checkbox moved above the list, clear of the top row's text, and pages hold six commands instead of seven to make room.
- Rule configuration pages no longer print the rule description across the top of the page, where long descriptions (e.g. "Ready to be summoned") overflowed onto the title and checkboxes. The description is available via the help (?) button, which already showed the same text.
- The room BC+ badge no longer sits on the character-cell boundary, where it appeared to belong to the neighboring character's icon cluster. It now fills the free in-row gap between BC's relationship icons and the WCE-side cluster (drawn slightly slimmer to fit), with a tighter halo.

## [0.4.5] - 2026-08-12

### Added
- The BC+ logo now shows above the head of every character running BC+ (including your own) — on the second icon row's right side, clear of BC's status icons and the BCX/WCE cluster, with a soft white halo so it reads on dark backgrounds. Hovering it shows that player's BC+ version, and the icon is grayed out when their permissions give you no access (same preview the remote menu uses). Works in the room view and the map view; toggleable on the General page ("Show the BC+ icon above BC+ users in the room", on by default).

## [0.4.4] - 2026-08-11

### Added
- Whisper commands: anyone your `commands.use` permission allows can whisper `!bcp <command>` to you to give orders without opening any menu — and without needing BC+ themselves. `!bcp help` lists exactly the commands that person may use; commands with text take it after the name (e.g. `!bcp say I am a good girl`). Replies arrive as targeted action messages (never garbled, not affected by whisper rules), gagged senders can wrap the command in OOC parentheses, and a checkbox on your Commands screen turns the whisper interface off entirely.
- New commands (menu and whisper): **Go to room** (sends the player to the named room, leaving their current one — full/missing rooms leave them in the room search), **Write lines** (e.g. `10 I will behave`, max 50 — the player's client tracks each typed line, announces completion in the room, logs it, and keeps the task across reloads; `stop` cancels), **Edge** (arousal to the brink), **Force orgasm** (resistible), and **Calm down** (arousal to zero). The arousal commands require the player's arousal meter to be enabled.
- Module on/off switches: the General page now has an enable checkbox for each feature module (Rules, Curses, Commands, Relationships, Log). Switching one off unloads it immediately — its hooks, timers and remote listeners stop, its main-menu button grays out — and it stays off across reloads until re-enabled. Toggling requires the new `core.modules` permission (Owner default, includes yourself; the Slave preset locks self-access). The main-menu help text now describes this instead of promising it.
- Log recording configuration: a "Configure..." button on your log screen chooses which categories get recorded (rules, curses, permissions, roles, relationships, commands/other — praise, scolds and notes are always recorded since they're gated by their own permissions). Changing the configuration requires the new `log.configure` permission (Owner default, includes yourself).
- Relationships in the Export/Import hub: custom-name lists can now be exported as a shareable code and imported (merged by member, every entry re-validated). The "Everything" code now bundles rules + curses + relationships.
- Module settings pages now render text settings, completing the settings framework — previously only rule configuration screens could show free-text fields.

### Fixed
- "Ready to be summoned" now announces the summon with a corner beep that is visible anywhere in the club — previously the announcement was a chat message, which is invisible when the summoned player is not sitting in a chat room (the move itself happened, but with no feedback it looked broken). The rule description now also spells out that the summoning beep must carry the sender's room ("attach room" left on when writing it), and dev builds log exactly why a beep did not summon.

## [0.4.3] - 2026-08-11

### Added
- Update notification: when a newer BC+ release is available, you now get a one-time beep per session ("v x.y.z is available — reload the club to update"), controlled by the same "Notify me in-club about BC+ updates" setting as the after-update beep.

### Fixed
- The Roles table no longer lists the same person twice: a lover who is also your BC Owner (or a manually assigned Co-Owner) only shows under the higher role. Permissions were never affected — only the highest role counts.

## [0.4.2] - 2026-08-11

### Added
- Version info on the main menu: "Your BC+ Version" always shows, remote menus add the viewed player's BC+ version below it, and a status line reports whether that version is the latest release (checked once per session against the BC+ website).

### Fixed
- The members and room-names text fields on the conditions screen (rules and curses) no longer float on top of the help text while help is open; the same applied to text fields on rule config screens (e.g. Forbidden words).

## [0.4.1] - 2026-08-10

### Changed
- Ghosted members are now always denied every BC+ permission, exactly like blacklisted members — regardless of their roles or custom-role grants. (Their client may still show buttons, but every command they send is rejected.)
- The manual "Owner" role is renamed to "Co-Owner" to distinguish it from your actual BC Owner. Existing saves migrate automatically, and settings synced from older BC+ clients are still understood.

## [0.4.0] - 2026-08-10

### Added
- Relationships module: give people custom names — the player sees that name instead of the real one in the chat room (name tags, chat messages, whispers), and entries marked "must use it" also block the player from saying the person's real name in chat or whispers (OOC is exempt; compound names like "Mistress Lana" still allow "Lana"). Add by member number or browse the room/friends/relationships picker. Works remotely with two new permissions: `relationships.view` (Mistress default) to see someone's list and `relationships.edit` (Owner default) to manage it — every change is validated by their client, notifies them, and lands in their log. The Slave preset now also locks self-access to relationship editing.
- Remote role management: the Roles screen now works on other BC+ users — see their role table (BC Owner and Lover from their visible relationships, Owner/Mistress/custom roles from their synced data) and add or remove assignments if their `roles.assign`/`roles.revoke` permissions allow you. Every change is validated by their client and confirmed via their auto-broadcast; they get notified and it lands in their log. Creating custom roles and editing grants stays local-only.
- Remote log clearing: a "Clear log" button on someone else's log (shown when their `log.delete` permission allows you), with a confirmation dialog. Their client validates, they're notified who cleared it, and your view refreshes.
- Praise, scold and notes: when viewing someone's log with the right permissions, you can praise or scold them (with an optional message) or attach a note — the entry lands in their behavior log with your name, they're notified, and your view refreshes. Two new permissions: `log.praise` and `log.note` (both Mistress default).
- Originator tracking: rules and curses now record who set them — shown on the rule config screen and hover details ("Set by ...") and on the curse slot screen ("Cursed by ..."). Recorded by your own client from the validated command sender; cleared when a rule deactivates; imports are attributed to the importer.
- Commands can be scoped in custom-role grants: a role can grant exactly the commands you pick (e.g. only Kneel), with anything else rejected per-command by the target's client.
- "Reset BC+" button on the General settings page: click once to arm it ("Confirm reset", 3-second window), click again to wipe all BC+ data and reload — same effect as `/bcp reset`.
- First-run welcome: new installs get a welcome notification pointing at the profile button, and the first menu open shows a short BC+ tour followed by the preset choice (with honest descriptions of each — including exactly what Slave gives up). Existing installs see it once too. "Decide later" keeps the Switch default.
- `/bcp reset` — factory reset: wipes all BC+ data (rules, curses, roles, permissions, log) after typing your member number to confirm, then reloads the club into a fresh first-time state.

### Changed
- Presets now configure your permissions to match when chosen: Dominant closes everything to others (BC Owner threshold) with full self-access; Switch applies the balanced defaults; Submissive is the defaults plus public viewing; Slave is Submissive plus removing your own access to rules, curses, permissions, roles and log clearing. The welcome tour and preset descriptions spell this out.
- Presets lock once chosen: picking a preset (in the welcome flow or General settings) asks for confirmation and then locks the choice — only a factory reset clears it. The General option shows as disabled while locked, and the lock is enforced even if something bypasses the disabled UI control.
- The `roles.manage` permission is split into `roles.assign` (add role assignments, create custom roles) and `roles.revoke` (remove assignments, delete custom roles) — so someone can be allowed to promote without being able to demote, or vice versa. Both default to Owner; existing custom-role grants of the old permission become inert.
- Authority screen is now a table: one row per permission with its name, a lowest-role selector and the self-access checkbox — all permissions on one page instead of two rows each across two pages. Works identically for remote viewing/editing.
- All browser popups (alert/confirm/prompt) replaced with BC+-styled in-page dialogs: dark themed, Enter confirms, Escape cancels, and they work everywhere — including during login before any screen exists.

### Fixed
- Bottom-row buttons no longer hang off the background: every footer button (Relationships, Log praise/scold/note/clear, custom-role delete, welcome screen) now ends at the same edge as the page selector, matching the Rules screen.
- Custom role grants editor now paginates (7 permissions per page) instead of running off the bottom of the screen as the permission list grew.
- Factory reset ("Reset BC+" button and `/bcp reset`) no longer crashes with "Invalid key 'BCP' attempting to save 'undefined'" — the server-side save is now removed the way BC expects, so the wipe completes and the club reloads cleanly.
- **Forbid breaking up with lovers** now actually blocks breakups: BC's chat-room relationship menu offers a direct "Tell X you want to break up" option (any stage, no waiting period) that bypassed the Management-mistress checks the rule relied on — the same gap currently making the equivalent BCX rule ineffective. The breakup request itself is now blocked, with a local explanation and a logged attempt.
- All five relationship protection rules (owner changes, new lovers, breaking up, new submissives, disowning) now also enforce at the point where the request is sent to the server, not just by hiding menu options — so a dialog that was already open (or any other UI path) can no longer slip a forbidden relationship change through.

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
