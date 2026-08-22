// bb-plugin-bots — backend entry.
//
// A "bot" is a name, an emoji, a block of instructions, and a model. Chatting
// with one spawns an ordinary BB thread; bb.agents.contributeInstructions then
// injects that bot's persona into every turn of that thread.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  clampInstructions,
  draftBlockers,
  MAX_INSTRUCTIONS,
  MAX_NAME,
  newBotId,
  pickEmoji,
  renderBotInstructions,
  rowToBot,
  type Bot,
  type BotRow,
} from "./bots.js";

const ReasoningLevel = z.enum([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
  "ultracode",
]);

const BotSchema = z.object({
  id: z.string(),
  name: z.string(),
  emoji: z.string(),
  instructions: z.string(),
  providerId: z.string(),
  model: z.string(),
  reasoningLevel: ReasoningLevel.nullable(),
  projectId: z.string().nullable(),
  status: z.enum(["draft", "published"]),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

// Lenient on purpose: the editor autosaves a half-typed bot on every
// keystroke, so nothing here can require a value. Validation moves to
// publish time (draftBlockers), where an incomplete bot actually matters.
const BotPatchSchema = z
  .object({
    name: z.string().max(MAX_NAME),
    emoji: z.string().min(1).max(16),
    instructions: z.string().max(MAX_INSTRUCTIONS),
    providerId: z.string(),
    model: z.string(),
    reasoningLevel: ReasoningLevel.nullable(),
    projectId: z.string().nullable(),
  })
  .partial()
  .strict();

const ChatSchema = z.object({
  threadId: z.string(),
  title: z.string().nullable(),
  status: z.string(),
  updatedAt: z.number().int(),
});

// Mirrors the host's `promptInputSchema` (bb-plugin-sdk-app.d.ts) exactly.
// This is the part that carries images, so it's spelled out rather than
// left opaque like `environment`/`executionInputSources` below.
const PromptInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string(),
    mentions: z.array(z.unknown()).default([]),
    visibility: z.literal("agent-only").optional(),
  }),
  z.object({
    type: z.literal("image"),
    url: z.string(),
    visibility: z.literal("agent-only").optional(),
  }),
  z.object({
    type: z.literal("localImage"),
    path: z.string(),
    visibility: z.literal("agent-only").optional(),
  }),
  z.object({
    type: z.literal("localFile"),
    path: z.string(),
    name: z.string().optional(),
    mimeType: z.string().optional(),
    sizeBytes: z.number().optional(),
    visibility: z.literal("agent-only").optional(),
  }),
]);

// The fully-resolved request `experimental_NewThreadComposer` submits.
// `executionInputSources` and `environment` are host-owned opaque shapes —
// mirroring them here would just rot, so they stay unknown and get cast at
// the `threads.spawn` boundary instead.
const NewThreadRequestSchema = z.object({
  projectId: z.string().min(1),
  providerId: z.string().min(1),
  model: z.string().min(1),
  reasoningLevel: ReasoningLevel,
  permissionMode: z.string(),
  serviceTier: z.string().optional(),
  executionInputSources: z.record(z.string(), z.unknown()),
  environment: z.unknown(),
  input: z.array(PromptInputSchema).min(1),
});

export const rpcContract = defineRpcContract({
  listBots: {
    input: z.null(),
    output: z.object({ bots: z.array(BotSchema) }),
  },
  getBot: {
    input: z.object({ botId: z.string() }).strict(),
    output: z.object({ bot: BotSchema.nullable() }),
  },
  // Writes an empty draft row immediately; the editor seeds and autosaves
  // provider/model/name itself via saveBot.
  createBot: {
    input: z.null(),
    output: z.object({ botId: z.string() }),
  },
  saveBot: {
    input: z.object({ botId: z.string(), patch: BotPatchSchema }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  publishBot: {
    input: z.object({ botId: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  deleteBot: {
    input: z.object({ botId: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  listChats: {
    input: z.object({ botId: z.string() }).strict(),
    output: z.object({ chats: z.array(ChatSchema) }),
  },
  // The rail's single round trip: every bot plus its chats in one call, so
  // the panel never has to fan out per-bot RPCs on load.
  listRail: {
    input: z.null(),
    output: z.object({
      bots: z.array(
        BotSchema.extend({
          chats: z.array(
            z.object({
              threadId: z.string(),
              title: z.string().nullable(),
              status: z.string(),
              updatedAt: z.number().int(),
            }),
          ),
          lastActivityAt: z.number().int(),
        }),
      ),
    }),
  },
  startChat: {
    input: z
      .object({ botId: z.string(), request: NewThreadRequestSchema })
      .strict(),
    output: z.object({ threadId: z.string() }),
  },
  listOptions: {
    input: z.null(),
    output: z.object({
      providers: z.array(
        z.object({
          id: z.string(),
          displayName: z.string(),
          available: z.boolean(),
        }),
      ),
      projects: z.array(z.object({ id: z.string(), name: z.string() })),
      personalProjectId: z.string().nullable(),
    }),
  },
  listModels: {
    input: z.object({ providerId: z.string() }).strict(),
    output: z.object({
      models: z.array(
        z.object({
          id: z.string(),
          displayName: z.string(),
          description: z.string(),
          isDefault: z.boolean(),
          defaultReasoningEffort: ReasoningLevel,
          reasoningEfforts: z.array(ReasoningLevel),
        }),
      ),
    }),
  },
});

export default async function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS bots (
       id              TEXT PRIMARY KEY,
       name            TEXT NOT NULL,
       emoji           TEXT NOT NULL,
       instructions    TEXT NOT NULL,
       provider_id     TEXT NOT NULL,
       model           TEXT NOT NULL,
       reasoning_level TEXT,
       project_id      TEXT,
       created_at      INTEGER NOT NULL,
       updated_at      INTEGER NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS bot_threads (
       thread_id  TEXT PRIMARY KEY,
       bot_id     TEXT NOT NULL,
       created_at INTEGER NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS bot_threads_bot_id ON bot_threads(bot_id)`,
    // The DEFAULT backfills every existing row as published, so there's no
    // separate backfill statement or code path.
    `ALTER TABLE bots ADD COLUMN status TEXT NOT NULL DEFAULT 'published'`,
  ]);

  // contributeInstructions is synchronous and sits on the thread-start path,
  // so SQLite is the durable store and these maps are the read path. A BB
  // plugin is one in-process module, so caching here is safe.
  const botsById = new Map<string, Bot>();
  const botIdByThreadId = new Map<string, string>();

  for (const row of db.prepare("SELECT * FROM bots").all() as BotRow[]) {
    botsById.set(row.id, rowToBot(row));
  }
  for (const row of db
    .prepare("SELECT thread_id, bot_id FROM bot_threads")
    .all() as { thread_id: string; bot_id: string }[]) {
    botIdByThreadId.set(row.thread_id, row.bot_id);
  }
  bb.log.info(
    `loaded ${botsById.size} bots across ${botIdByThreadId.size} threads`,
  );

  // The whole point of the plugin. Returning null for unmapped threads is
  // load-bearing: without it every thread in BB would inherit a bot persona.
  bb.agents.contributeInstructions(({ threadId }) => {
    const botId = botIdByThreadId.get(threadId);
    if (botId === undefined) return null;
    const bot = botsById.get(botId);
    if (bot === undefined) return null;
    return renderBotInstructions(bot);
  });

  function readBot(botId: string): Bot {
    const bot = botsById.get(botId);
    if (bot === undefined) throw new Error(`Unknown bot: ${botId}`);
    return bot;
  }

  function announce() {
    bb.realtime.publish("bots", { changedAt: Date.now() });
  }

  bb.rpc.register(rpcContract, {
    listBots: () => ({
      bots: [...botsById.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    }),

    getBot: ({ botId }) => ({ bot: botsById.get(botId) ?? null }),

    // Writes a bare row immediately so the editor has a botId to autosave
    // against from the very first keystroke. The editor seeds and saves
    // provider/model/name itself via saveBot right after.
    createBot: () => {
      const now = Date.now();
      const bot: Bot = {
        id: newBotId(),
        name: "",
        emoji: pickEmoji(),
        instructions: "",
        providerId: "",
        model: "",
        reasoningLevel: null,
        projectId: null,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      };
      db.prepare(
        `INSERT INTO bots (id, name, emoji, instructions, provider_id, model,
                           reasoning_level, project_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        bot.id,
        bot.name,
        bot.emoji,
        bot.instructions,
        bot.providerId,
        bot.model,
        bot.reasoningLevel,
        bot.projectId,
        bot.status,
        bot.createdAt,
        bot.updatedAt,
      );
      botsById.set(bot.id, bot);
      announce();
      return { botId: bot.id };
    },

    // Applies only the keys the editor actually sent — an autosave from a
    // half-typed form must never blow away fields the user hasn't touched
    // yet — and never touches status; that's publishBot's job alone.
    saveBot: ({ botId, patch }) => {
      const existing = readBot(botId);
      const bot: Bot = {
        ...existing,
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.emoji !== undefined ? { emoji: patch.emoji } : {}),
        ...(patch.instructions !== undefined
          ? { instructions: clampInstructions(patch.instructions) }
          : {}),
        ...(patch.providerId !== undefined
          ? { providerId: patch.providerId }
          : {}),
        ...(patch.model !== undefined ? { model: patch.model } : {}),
        ...(patch.reasoningLevel !== undefined
          ? { reasoningLevel: patch.reasoningLevel }
          : {}),
        ...(patch.projectId !== undefined
          ? { projectId: patch.projectId }
          : {}),
        updatedAt: Date.now(),
      };
      db.prepare(
        `UPDATE bots
            SET name = ?, emoji = ?, instructions = ?, provider_id = ?,
                model = ?, reasoning_level = ?, project_id = ?, updated_at = ?
          WHERE id = ?`,
      ).run(
        bot.name,
        bot.emoji,
        bot.instructions,
        bot.providerId,
        bot.model,
        bot.reasoningLevel,
        bot.projectId,
        bot.updatedAt,
        bot.id,
      );
      botsById.set(bot.id, bot);
      announce();
      return { ok: true };
    },

    // Publishing an already-published bot is a no-op success — the editor
    // doesn't need to know which state it started in.
    publishBot: ({ botId }) => {
      const existing = readBot(botId);
      if (existing.status === "published") return { ok: true };
      const blockers = draftBlockers(existing);
      if (blockers.length > 0) {
        throw new Error(`Missing: ${blockers.join(", ")}`);
      }
      const bot: Bot = {
        ...existing,
        status: "published",
        updatedAt: Date.now(),
      };
      db.prepare("UPDATE bots SET status = ?, updated_at = ? WHERE id = ?").run(
        bot.status,
        bot.updatedAt,
        bot.id,
      );
      botsById.set(bot.id, bot);
      announce();
      return { ok: true };
    },

    // Deletes the bot and its thread mappings. The threads themselves are real
    // conversations, so they stay — they just stop receiving the persona.
    deleteBot: ({ botId }) => {
      db.prepare("DELETE FROM bot_threads WHERE bot_id = ?").run(botId);
      db.prepare("DELETE FROM bots WHERE id = ?").run(botId);
      botsById.delete(botId);
      for (const [threadId, mapped] of botIdByThreadId) {
        if (mapped === botId) botIdByThreadId.delete(threadId);
      }
      announce();
      return { ok: true };
    },

    // One threads.list call filtered by our own mapping — never a per-thread
    // threads.get loop.
    listChats: async ({ botId }) => {
      const mine = new Set(
        (
          db
            .prepare("SELECT thread_id FROM bot_threads WHERE bot_id = ?")
            .all(botId) as { thread_id: string }[]
        ).map((row) => row.thread_id),
      );
      if (mine.size === 0) return { chats: [] };
      const threads = await bb.sdk.threads.list({
        originPluginId: bb.pluginId,
        limit: 200,
      });
      return {
        chats: threads
          .filter((thread) => mine.has(thread.id))
          .map((thread) => ({
            threadId: thread.id,
            title: thread.title ?? thread.titleFallback,
            status: thread.status,
            updatedAt: thread.updatedAt,
          }))
          .sort((a, b) => b.updatedAt - a.updatedAt),
      };
    },

    // The rail's one round trip: a single threads.list call, bucketed by
    // bot_threads in memory. Never a per-bot threads.list or a per-thread
    // threads.get.
    listRail: async () => {
      const chatsByBotId = new Map<
        string,
        { threadId: string; title: string | null; status: string; updatedAt: number }[]
      >();
      const botIdByThreadIdRows = db
        .prepare("SELECT thread_id, bot_id FROM bot_threads")
        .all() as { thread_id: string; bot_id: string }[];
      const botIdByOwnThreadId = new Map(
        botIdByThreadIdRows.map((row) => [row.thread_id, row.bot_id]),
      );
      const threads = await bb.sdk.threads.list({
        originPluginId: bb.pluginId,
        limit: 200,
      });
      for (const thread of threads) {
        const botId = botIdByOwnThreadId.get(thread.id);
        if (botId === undefined) continue;
        const chats = chatsByBotId.get(botId) ?? [];
        chats.push({
          threadId: thread.id,
          title: thread.title ?? thread.titleFallback,
          status: thread.status,
          updatedAt: thread.updatedAt,
        });
        chatsByBotId.set(botId, chats);
      }
      const bots = [...botsById.values()].map((bot) => {
        const chats = (chatsByBotId.get(bot.id) ?? []).sort(
          (a, b) => b.updatedAt - a.updatedAt,
        );
        const newestChatAt = chats[0]?.updatedAt ?? 0;
        return {
          ...bot,
          chats,
          lastActivityAt: Math.max(bot.updatedAt, newestChatAt),
        };
      });
      bots.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
      return { bots };
    },

    // The composer already resolved a concrete projectId and environment
    // (including "Don't work in a project", which submits the personal
    // project id, not null), so there's nothing left to resolve here. Note
    // this makes the bot's stored provider/model/project/reasoning SEEDS for
    // the composer, not enforcement — a chat can be started on a different
    // model or project than the bot was configured with, and the persona
    // still applies because contributeInstructions maps per-thread, not
    // per-model.
    startChat: async ({ botId, request }) => {
      const bot = readBot(botId);
      if (bot.status === "draft") {
        throw new Error("Publish this bot before starting a chat");
      }

      // The composer already validated these against the host's literal
      // unions (permission mode, mention structure, environment /
      // executionInputSources internals). Re-typing them from our
      // deliberately-loose zod schema would just rot, so cast once at the
      // spawn boundary instead of mirroring the host's internal types here.
      const spawnArgs = {
        projectId: request.projectId,
        providerId: request.providerId,
        model: request.model,
        reasoningLevel: request.reasoningLevel,
        permissionMode: request.permissionMode,
        ...(request.serviceTier === undefined
          ? {}
          : { serviceTier: request.serviceTier }),
        executionInputSources: request.executionInputSources,
        environment: request.environment,
        input: request.input,
        // Deliberately omitted: title is optional in CreateThreadRequest and
        // BB auto-titles the thread from its first message. Passing bot.name
        // here used to make every chat literally named after the bot.
      };
      const thread = await bb.sdk.threads.spawn(
        spawnArgs as Parameters<typeof bb.sdk.threads.spawn>[0],
      );

      db.prepare(
        "INSERT INTO bot_threads (thread_id, bot_id, created_at) VALUES (?, ?, ?)",
      ).run(thread.id, bot.id, Date.now());
      botIdByThreadId.set(thread.id, bot.id);
      bb.log.info(`started chat ${thread.id} for bot ${bot.id}`);
      return { threadId: thread.id };
    },

    listOptions: async () => {
      const [providers, projects, allProjects] = await Promise.all([
        bb.sdk.providers.list(),
        bb.sdk.projects.list(),
        bb.sdk.projects.list({ includePersonal: true }),
      ]);
      const personal = allProjects.find(
        (project) => project.kind === "personal",
      );
      return {
        providers: providers.map((provider) => ({
          id: provider.id,
          displayName: provider.displayName,
          available: provider.available,
        })),
        projects: projects.map((project) => ({
          id: project.id,
          name: project.name,
        })),
        personalProjectId: personal?.id ?? null,
      };
    },

    listModels: async ({ providerId }) => {
      const options = await bb.sdk.providers.models({ providerId });
      return {
        models: options.models.map((model) => ({
          id: model.id,
          displayName: model.displayName,
          description: model.description,
          isDefault: model.isDefault,
          defaultReasoningEffort: model.defaultReasoningEffort,
          reasoningEfforts: model.supportedReasoningEfforts.map(
            (effort) => effort.reasoningEffort,
          ),
        })),
      };
    },
  });

  // Keep the mapping from growing without bound. Archived threads are still
  // resumable, so only deletion drops the persona link.
  bb.events.on("thread.deleted", ({ thread }) => {
    if (!botIdByThreadId.delete(thread.id)) return;
    db.prepare("DELETE FROM bot_threads WHERE thread_id = ?").run(thread.id);
  });
}
