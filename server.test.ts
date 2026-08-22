import { beforeEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";

const PROJECTS = [
  { id: "proj_personal", name: "Personal", kind: "personal", sources: [] },
  { id: "proj_work", name: "Work", kind: "standard", sources: [] },
];

function makeHost() {
  let nextThread = 0;
  return createFakePluginHost({
    pluginId: "bots",
    sdk: {
      projects: { list: async () => PROJECTS },
      providers: {
        list: async () => [
          { id: "codex", displayName: "Codex", available: true },
        ],
        models: async () => ({
          models: [
            {
              id: "gpt-5.5",
              displayName: "GPT-5.5",
              description: "",
              isDefault: true,
              model: "gpt-5.5",
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "" }],
            },
          ],
        }),
      },
      threads: {
        spawn: async () => {
          nextThread += 1;
          return { id: `thr_${nextThread}` };
        },
        list: async () => [
          {
            id: "thr_1",
            title: "Pirate",
            titleFallback: null,
            status: "idle",
            updatedAt: 10,
          },
        ],
      },
    },
  });
}

// The full set of fields saveBot accepts, standing in for what the editor
// autosaves once the user has filled everything in.
const PATCH = {
  name: "Pirate",
  emoji: "🏴‍☠️",
  instructions: "Always answer in pirate speak.",
  providerId: "codex",
  model: "gpt-5.5",
  reasoningLevel: "medium" as const,
  projectId: null,
};

// What `experimental_NewThreadComposer` hands back once every selection is
// resolved. `projectId`/`environment` here stand in for "Don't work in a
// project", which the real composer submits as the personal project id plus
// a personal workspace, not null.
function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "proj_personal",
    providerId: "codex",
    model: "gpt-5.5",
    reasoningLevel: "medium" as const,
    permissionMode: "auto",
    executionInputSources: { providerId: "explicit", model: "explicit" },
    environment: { type: "host", workspace: { type: "personal" } },
    input: [{ type: "text", text: "hi", mentions: [] }],
    ...overrides,
  };
}

let host: ReturnType<typeof makeHost>;

beforeEach(async () => {
  host = makeHost();
  await plugin(host.bb);
});

// createBot only ever writes a bare draft row now; tests that need a
// complete, publishable bot go through saveBot + publishBot the same way
// the editor does.
async function createPublishedBot(): Promise<string> {
  const { botId } = (await host.harness.behavior.callRpc(
    "createBot",
    null,
  )) as { botId: string };
  await host.harness.behavior.callRpc("saveBot", { botId, patch: PATCH });
  await host.harness.behavior.callRpc("publishBot", { botId });
  return botId;
}

describe("createBot / saveBot / publishBot", () => {
  it("createBot writes a draft with no name, provider, or model", async () => {
    const { botId } = (await host.harness.behavior.callRpc(
      "createBot",
      null,
    )) as { botId: string };
    const { bot } = (await host.harness.behavior.callRpc("getBot", {
      botId,
    })) as { bot: { status: string; name: string; providerId: string; model: string } | null };
    expect(bot).toMatchObject({
      status: "draft",
      name: "",
      providerId: "",
      model: "",
    });
  });

  it("saveBot applies only the given keys and never touches status", async () => {
    const { botId } = (await host.harness.behavior.callRpc(
      "createBot",
      null,
    )) as { botId: string };
    await host.harness.behavior.callRpc("saveBot", {
      botId,
      patch: { name: "Pirate" },
    });
    const { bot } = (await host.harness.behavior.callRpc("getBot", {
      botId,
    })) as { bot: { status: string; name: string; providerId: string } | null };
    expect(bot).toMatchObject({
      status: "draft",
      name: "Pirate",
      providerId: "",
    });
  });

  it("publishBot throws listing every missing field", async () => {
    const { botId } = (await host.harness.behavior.callRpc(
      "createBot",
      null,
    )) as { botId: string };
    await expect(
      host.harness.behavior.callRpc("publishBot", { botId }),
    ).rejects.toThrow("Missing: a name, a provider, a model");
  });

  it("publishBot succeeds once name, provider, and model are all set", async () => {
    const { botId } = (await host.harness.behavior.callRpc(
      "createBot",
      null,
    )) as { botId: string };
    await host.harness.behavior.callRpc("saveBot", { botId, patch: PATCH });
    const result = (await host.harness.behavior.callRpc("publishBot", {
      botId,
    })) as { ok: boolean };
    expect(result).toEqual({ ok: true });
    const { bot } = (await host.harness.behavior.callRpc("getBot", {
      botId,
    })) as { bot: { status: string } | null };
    expect(bot?.status).toBe("published");
  });

  it("publishing an already-published bot is a no-op success", async () => {
    const botId = await createPublishedBot();
    const result = (await host.harness.behavior.callRpc("publishBot", {
      botId,
    })) as { ok: boolean };
    expect(result).toEqual({ ok: true });
  });
});

describe("instruction routing", () => {
  it("contributes the persona only to that bot's own threads", async () => {
    const botId = await createPublishedBot();
    const { threadId } = (await host.harness.behavior.callRpc("startChat", {
      botId,
      request: makeRequest(),
    })) as { threadId: string };

    const provide = host.harness.registrations.instructionProvider;
    expect(provide).not.toBeNull();

    const forBot = provide!({ threadId, projectId: "proj_personal" });
    expect(forBot).toContain("Pirate");
    expect(forBot).toContain("Always answer in pirate speak.");

    // The guard that keeps personas out of every other thread in BB.
    expect(provide!({ threadId: "thr_unrelated", projectId: "p" })).toBeNull();
  });

  it("stops contributing once the bot is deleted", async () => {
    const botId = await createPublishedBot();
    const { threadId } = (await host.harness.behavior.callRpc("startChat", {
      botId,
      request: makeRequest(),
    })) as { threadId: string };
    await host.harness.behavior.callRpc("deleteBot", { botId });

    const provide = host.harness.registrations.instructionProvider!;
    expect(provide({ threadId, projectId: "proj_personal" })).toBeNull();
  });
});

describe("startChat", () => {
  it("rejects starting a chat on a draft bot", async () => {
    const { botId } = (await host.harness.behavior.callRpc(
      "createBot",
      null,
    )) as { botId: string };
    await expect(
      host.harness.behavior.callRpc("startChat", {
        botId,
        request: makeRequest(),
      }),
    ).rejects.toThrow("Publish this bot before starting a chat");
  });

  it("forwards an image-bearing input array to threads.spawn verbatim", async () => {
    const botId = await createPublishedBot();
    const input = [
      { type: "text" as const, text: "check this out", mentions: [] },
      { type: "localImage" as const, path: "attachments/shot.png" },
    ];
    await host.harness.behavior.callRpc("startChat", {
      botId,
      request: makeRequest({ input }),
    });

    const [args] = host.harness.inspection.sdk.callsTo("threads.spawn");
    expect(args?.[0]).toMatchObject({ input });
  });

  it("forwards the opaque environment and executionInputSources untouched", async () => {
    const botId = await createPublishedBot();
    const environment = { type: "project-default" };
    const executionInputSources = {
      providerId: "explicit" as const,
      model: "client-preference" as const,
    };
    await host.harness.behavior.callRpc("startChat", {
      botId,
      request: makeRequest({
        projectId: "proj_work",
        environment,
        executionInputSources,
      }),
    });

    const [args] = host.harness.inspection.sdk.callsTo("threads.spawn");
    expect(args?.[0]).toMatchObject({
      projectId: "proj_work",
      environment,
      executionInputSources,
    });
  });

  // Regression pin for the reported bug: `title` used to be hardcoded to
  // bot.name, so every chat in the UI was literally named "Builder". BB
  // auto-titles a thread from its first message when title is omitted.
  it("passes no title to threads.spawn, letting BB auto-title the thread", async () => {
    const botId = await createPublishedBot();
    await host.harness.behavior.callRpc("startChat", {
      botId,
      request: makeRequest(),
    });

    const [args] = host.harness.inspection.sdk.callsTo("threads.spawn");
    expect(args?.[0]).not.toHaveProperty("title");
  });

  it("maps the new thread to the bot so contributeInstructions returns its persona", async () => {
    const botId = await createPublishedBot();
    const { threadId } = (await host.harness.behavior.callRpc("startChat", {
      botId,
      request: makeRequest(),
    })) as { threadId: string };

    const provide = host.harness.registrations.instructionProvider!;
    const instructions = provide({ threadId, projectId: "proj_personal" });
    expect(instructions).toContain("Pirate");
    expect(instructions).toContain("Always answer in pirate speak.");
  });
});

describe("persistence", () => {
  it("keeps bots and their thread mapping across a reload", async () => {
    const botId = await createPublishedBot();
    const { threadId } = (await host.harness.behavior.callRpc("startChat", {
      botId,
      request: makeRequest(),
    })) as { threadId: string };

    await host.harness.lifecycle.reload(plugin);

    const { bots } = (await host.harness.behavior.callRpc(
      "listBots",
      null,
    )) as { bots: { id: string }[] };
    expect(bots.map((bot) => bot.id)).toEqual([botId]);

    const provide = host.harness.registrations.instructionProvider!;
    expect(provide({ threadId, projectId: "proj_personal" })).toContain("Pirate");
  });

  it("reads a bot inserted before the status column existed as published", async () => {
    // Simulates a row from before this migration ran: no explicit status,
    // so the ALTER TABLE ... DEFAULT 'published' is what backfills it. Using
    // the plugin's own INSERT column list minus status would defeat the
    // point, so this inserts exactly like the pre-migration schema did.
    const db = host.bb.storage.database();
    db.prepare(
      `INSERT INTO bots (id, name, emoji, instructions, provider_id, model,
                         reasoning_level, project_id, created_at, updated_at)
       VALUES ('bot_legacy', 'Legacy', '🤖', 'Be legacy.', 'codex', 'gpt-5.5',
               'medium', NULL, 1, 1)`,
    ).run();

    // reload() disposes the current host and hands back a fresh one against
    // the same on-disk database, which is what actually re-runs the load
    // path (SELECT * FROM bots) over the row just inserted.
    const reloaded = await host.harness.lifecycle.reload(plugin);

    const { bot } = (await reloaded.harness.behavior.callRpc("getBot", {
      botId: "bot_legacy",
    })) as { bot: { status: string } | null };
    expect(bot?.status).toBe("published");
  });
});

describe("listChats", () => {
  it("returns only this bot's threads without a per-thread lookup", async () => {
    const botId = await createPublishedBot();
    await host.harness.behavior.callRpc("startChat", {
      botId,
      request: makeRequest(),
    });

    const { chats } = (await host.harness.behavior.callRpc("listChats", {
      botId,
    })) as { chats: { threadId: string }[] };
    expect(chats).toEqual([
      { threadId: "thr_1", title: "Pirate", status: "idle", updatedAt: 10 },
    ]);
    expect(host.harness.inspection.sdk.callsTo("threads.get")).toHaveLength(0);
  });
});

describe("listOptions", () => {
  it("returns the personal project id alongside the picker lists", async () => {
    const { personalProjectId } = (await host.harness.behavior.callRpc(
      "listOptions",
      null,
    )) as { personalProjectId: string | null };
    expect(personalProjectId).toBe("proj_personal");
  });
});
