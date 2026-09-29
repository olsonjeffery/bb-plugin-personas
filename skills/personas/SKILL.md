---
name: personas
description: "BB Personas settings and operating constraints: the prompt pool, the Plugin health section, the Floating Notes availability flag, and how to develop the plugin."
---

# Personas

Personas gives each persona its own name, a pool of prompts, a provider, a
model, and a reasoning level. Persona chats are ordinary BB threads; each
thread receives the persona's joined prompt pool as instructions on every
turn.

## The prompt pool

- A persona's standing instructions are prompts in its pool (the
  `persona_prompts` SQLite table). Each prompt is tied to exactly one
  persona; deleting the persona deletes its pool.
- Prompt types are extensible (`PROMPT_TYPES` in `personas.ts`); `text` is
  the only type so far, and any unrecognized stored type reads as `text`.
- Each prompt holds up to 3500 characters (`MAX_PROMPT_TEXT`). Pool entries
  in the editor display the first 24 characters plus an ellipsis on
  overflow (`PROMPT_PREVIEW_LIMIT`).
- One persona's pool never holds two prompts whose first 24 characters are
  identical. The rule is enforced server-side in `addPersonaPrompt` /
  `updatePersonaPrompt` and pre-checked in the editor; the same text on two
  different personas is fine.
- The joined pool text is injected into every turn of the persona's chats
  (`renderPersonaInstructions`), clamped to BB's 4096-character
  instruction-contribution limit when the pool outgrows it.
- Databases from before the pool carry each persona's legacy single
  `instructions` column into one text prompt on the next start — once per
  persona, idempotent across restarts.

## Settings

**Settings → Installed plugins → Personas** shows a **Plugin health**
section: one row per cooperating plugin this one can use.

- **Floating Notes** — a green check when it is installed and enabled, a red
  X when it is not.
- **Docs** — BB's official Docs plugin (installed id `simple-notes`): a green
  check when it is installed and enabled, a red X when it is not.
- A missing plugin shows an inline **Install** link to its bb plugin page
  (Floating Notes: <https://github.com/vburojevic/bb-plugin-floating-notes>;
  Docs: <https://github.com/get-bb/bb/tree/main/plugins/docs>).
- Rows read fresh from the installed-plugin list on every visit; installs,
  enables, and disables are reflected on the next open.

## Operating constraints

- Requires bb `>=0.39.0` and bbPluginSdk `>=0.4.8`.
- No secrets, no plugin-level settings; all persona data lives in the
  plugin's own SQLite database inside bb's data directory.
- A plugin counts as available only when it is installed, enabled, and not in
  a hard-failure status (`disabled`, `missing`, `error`, `incompatible`).
  The server-side `floatingNotesAvailable` flag (`plugin-health.ts`) and the
  settings rows share this one rule.
- Deleting a persona never deletes its chats; they just stop receiving the
  persona's prompts.

## Development

```sh
npm test             # vitest: server (fake host) + app (jsdom slot tests)
npm run typecheck    # tsc --noEmit
bb plugin build      # dist bundle before install or release
bb plugin dev        # watch: rebuild and reload on every save
bb plugin logs personas -f
```
