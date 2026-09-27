---
name: personas
description: "BB Personas settings and operating constraints: the Plugin health section, the Floating Notes availability flag, and how to develop the plugin."
---

# Personas

Personas gives each persona its own name, instructions, provider, model, and
reasoning level. Persona chats are ordinary BB threads; each thread receives
its persona's instructions on every turn.

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
  persona's instructions.

## Development

```sh
npm test             # vitest: server (fake host) + app (jsdom slot tests)
npm run typecheck    # tsc --noEmit
bb plugin build      # dist bundle before install or release
bb plugin dev        # watch: rebuild and reload on every save
bb plugin logs personas -f
```
