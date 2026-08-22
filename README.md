# Bots — a BB plugin

Create custom bots (like Grok bots or custom GPTs) with their own name, icon,
instructions, and model, then chat with them inside BB.

A **Bots** row appears in the BB sidebar. Opening it gives a two-pane layout: a
rail of your bots on the left, rendered like chat items, and the conversation on
the right. Clicking a bot drops you straight into its newest chat — or into a
fresh composer if it has none.

Each bot stores:

- a name and an auto-assigned emoji icon (shuffle or keep it)
- instructions the agent follows on every turn
- a provider, model, and reasoning level
- an optional project — set it and chats can read that repo; leave it empty for
  plain projectless chat
- a `status` of `draft` or `published`

## Drafts

"New bot" writes a row immediately, as a **draft**, and the editor autosaves
every keystroke (600ms debounce, flushed on unmount and window blur) — closing
the panel mid-setup never loses work. A draft carries a DRAFT badge in the rail
and cannot start chats: `startChat` rejects it on the server, not just in the
UI. **Publish** runs `draftBlockers()` and refuses until the bot has a name, a
provider, and a model, naming whichever are missing.

The `status` column arrived as an additive migration with
`DEFAULT 'published'`, so bots created before drafts existed stayed live with no
backfill code.

## Chat titles

`startChat` deliberately omits `title` when calling `threads.spawn`. `title` is
optional in `CreateThreadRequest`, and BB auto-titles a thread from its first
message; passing `bot.name` (as an earlier version did) made every conversation
with a bot show up under that bot's name instead of what it was about.

## How the persona is applied

BB threads have no system-prompt field. Instead the backend registers
`bb.agents.contributeInstructions()`, which BB evaluates at `thread.start` and
`turn.submit`. The plugin maps each chat thread back to its bot and returns that
bot's instruction block — and returns `null` for every other thread in BB, so a
persona never leaks outside its own chats.

Because that callback is synchronous and sits on the thread-start path, SQLite
is the durable store and two in-memory `Map`s are the read path, hydrated on
load. `server.test.ts` pins both the hit and the `null` fallthrough.

Chats are ordinary visible BB threads, so they appear in the sidebar and can be
opened, archived, or deleted like any other. Deleting a bot leaves its
conversations intact; they simply stop receiving the instructions.

Editing a bot applies to the **next** chat. BB never mutates a running provider
session, so an in-flight conversation keeps the instructions it started with.

## Layout

| File | Role |
| --- | --- |
| `bots.ts` | Pure logic: emoji/tint, instruction rendering, route parsing. No BB handle. |
| `server.ts` | Storage, migrations, the instruction hook, the RPC contract, thread cleanup. |
| `app.tsx` | Registers the nav panel; owns the rail + content-pane shell and route dispatch. |
| `components/BotRail.tsx` | The left rail: bots as chat rows, nested chats, draft badges, resize. |
| `components/BotHome.tsx` | A bot's landing pane (clamped instructions, composer) and the shared header. |
| `components/BotChatView.tsx` | Shared header over BB's own `ThreadChat`. |
| `components/BotEditor.tsx` | Autosaving setup form; publish for drafts, save for live bots. |

Both chat surfaces are host-owned: the chat view is BB's own `ThreadChat`
component, and the first-message box on a bot's page is BB's own
`experimental_NewThreadComposer`. The plugin never reimplements a timeline or
a composer — it only forwards the fully-resolved `NewThreadRequest` the
composer hands back to its own `startChat` rpc, which passes it straight to
`threads.spawn`.

### Images and attachments

Starting a chat supports attaching images — paperclip, drag-drop, and paste —
because `experimental_NewThreadComposer` owns attachment upload itself. It
hands back `localImage`/`localFile` prompt parts alongside any text, and
`startChat` forwards that `input` array to `threads.spawn` verbatim, without
inspecting or re-validating individual parts. Follow-up turns already
supported images through the host `ThreadChat` composer; this closes the gap
on the one surface the plugin used to own.

### Seeds, not enforcement

A bot's stored provider, model, project, and reasoning level seed the
composer's pickers, but the user can change any of them before sending —
`threads.spawn` is told whatever the composer actually resolved, not what the
bot record says. This is fine: the persona is bound per-thread by
`contributeInstructions`, not by matching a model or project, so a chat
started on a different model still gets the bot's instructions.

## Development

```sh
bb plugin install .     # register this directory in place
bb plugin dev           # rebuild + reload on save
bb plugin logs bots -f  # follow backend logs

npm test                # vitest: pure logic, fake plugin host, panel rendering
npm run typecheck
```
