// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { EMOJIS } from "./bots";

const BOT_WITH_CHATS = {
  id: "bot_1",
  name: "Pirate",
  emoji: "🏴‍☠️",
  instructions: "Always answer in pirate speak.",
  providerId: "codex",
  model: "gpt-5.5",
  reasoningLevel: "medium" as const,
  projectId: null,
  status: "published" as const,
  createdAt: 0,
  updatedAt: 100,
};

const BOT_NO_CHATS = {
  id: "bot_2",
  name: "Builder",
  emoji: "🤖",
  instructions: "Fix the bot builder UX. ".repeat(20),
  providerId: "codex",
  model: "gpt-5.5",
  reasoningLevel: "medium" as const,
  projectId: null,
  status: "published" as const,
  createdAt: 0,
  updatedAt: 50,
};

const BOT_DRAFT = {
  id: "bot_3",
  name: "",
  emoji: "🧪",
  instructions: "",
  providerId: "",
  model: "",
  reasoningLevel: null,
  projectId: null,
  status: "draft" as const,
  createdAt: 0,
  updatedAt: 10,
};

const BOT_NAMED_DRAFT = {
  id: "bot_4",
  name: "Switcher",
  emoji: "🧪",
  instructions: "",
  providerId: "codex",
  model: "gpt-5.5",
  reasoningLevel: "medium" as const,
  projectId: null,
  status: "draft" as const,
  createdAt: 0,
  updatedAt: 10,
};

const RAIL_BOTS = [
  {
    ...BOT_WITH_CHATS,
    chats: [
      { threadId: "thr_new", title: "Ahoy there", status: "active", updatedAt: 200 },
    ],
    lastActivityAt: 200,
  },
  { ...BOT_NO_CHATS, chats: [], lastActivityAt: BOT_NO_CHATS.updatedAt },
  { ...BOT_DRAFT, chats: [], lastActivityAt: BOT_DRAFT.updatedAt },
];

const BOTS_BY_ID: Record<
  string,
  typeof BOT_WITH_CHATS | typeof BOT_NO_CHATS | typeof BOT_DRAFT
> = {
  bot_1: BOT_WITH_CHATS,
  bot_2: BOT_NO_CHATS,
  bot_3: BOT_DRAFT,
};

const RPC = {
  listRail: () => ({ bots: RAIL_BOTS }),
  getBot: (input: unknown) => {
    const { botId } = input as { botId: string };
    return { bot: BOTS_BY_ID[botId] ?? null };
  },
  listChats: (input: unknown) => {
    const { botId } = input as { botId: string };
    if (botId === "bot_1") {
      return {
        chats: [
          { threadId: "thr_new", title: "Ahoy there", status: "active", updatedAt: 200 },
        ],
      };
    }
    return { chats: [] };
  },
  listOptions: () => ({
    providers: [{ id: "codex", displayName: "Codex", available: true }],
    projects: [{ id: "proj_work", name: "Work" }],
    personalProjectId: "proj_personal",
  }),
  listModels: () => ({
    models: [
      {
        id: "gpt-5.5",
        displayName: "GPT-5.5",
        description: "",
        isDefault: true,
        defaultReasoningEffort: "medium" as const,
        reasoningEfforts: ["medium" as const],
      },
    ],
  }),
  startChat: () => ({ threadId: "thr_from_home" }),
  createBot: () => ({ botId: "bot_new" }),
  saveBot: () => ({ ok: true }),
  publishBot: () => ({ ok: true }),
  deleteBot: () => ({ ok: true }),
};

async function loadPanel() {
  const app = await loadPluginApp(() => import("./app"));
  const [panel] = app.navPanels;
  expect(panel).toBeDefined();
  return panel!;
}

describe("bots nav panel", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers one panel at the bots path", async () => {
    const panel = await loadPanel();
    expect(panel.id).toBe("bots");
    expect(panel.path).toBe("bots");
    expect(panel.title).toBe("Bots");
  });

  it("renders the rail with bots, marking drafts with a DRAFT badge", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "" }, { rpc: RPC });
    await slot.findByText("Pirate");
    await slot.findByText("Builder");
    await slot.findByText("DRAFT");
    slot.lifecycle.unmount();
  });

  it("navigates to a bot when its rail row is clicked", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "" }, { rpc: RPC });
    (await slot.findByText("Builder")).click();
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "bots",
      options: { subPath: "bot_2" },
    });
    slot.lifecycle.unmount();
  });

  it("creates a bot from the rail's new-bot button and routes to its editor", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "" }, { rpc: RPC });
    (await slot.findByLabelText("New bot")).click();

    await waitFor(() =>
      expect(slot.inspection.navigateCalls).toContainEqual({
        method: "toPluginPanel",
        path: "bots",
        options: { subPath: "bot_new/edit" },
      }),
    );
    const createCall = slot.inspection.rpcCalls.find(
      (call) => call.method === "createBot",
    );
    expect(createCall?.input).toBeNull();
    slot.lifecycle.unmount();
  });

  it("shows the composer for a bot with chats instead of redirecting into the newest one", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "bot_1" }, { rpc: RPC });

    await slot.findByTestId("bb-new-thread-composer");
    expect(slot.inspection.navigateCalls).toEqual([]);
    slot.lifecycle.unmount();
  });

  it("renders the chat list inside the bot page and navigates to a chat on click", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "bot_1" }, { rpc: RPC });

    await slot.findByText("Chats (1)");
    // "Ahoy there" also appears as the rail row's newest-chat preview, so
    // pick out the one that lives inside the bot page's chat list.
    const chatRowLabel = (await slot.findAllByText("Ahoy there")).find(
      (node) => node.closest("ul.divide-y") !== null,
    );
    expect(chatRowLabel).toBeDefined();
    chatRowLabel!.closest("button")!.click();

    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "bots",
      options: { subPath: "bot_1/thr_new" },
    });
    slot.lifecycle.unmount();
  });

  it("keeps the rail flat — no expand toggle and no duplicated nested chat row", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "" }, { rpc: RPC });

    await slot.findByText("Pirate");
    expect(slot.queryByLabelText("Expand chats")).toBeNull();
    expect(slot.queryByLabelText("Collapse chats")).toBeNull();
    // "Ahoy there" is the newest-chat preview on the bot's own row; a nested
    // chat row used to duplicate it directly underneath.
    expect(slot.getAllByText("Ahoy there")).toHaveLength(1);
    slot.lifecycle.unmount();
  });

  // Regression coverage for the shipped bug: the "⋯" trigger had both
  // onClick and onBlur, so moving focus from the trigger to any menu item
  // fired the trigger's blur (closing and unmounting the menu) before the
  // item's own click could land. Every item was dead. This drives the same
  // focus transfer a real mousedown-then-click does — trigger.focus(), then
  // item.focus() (which fires the trigger's blur with relatedTarget set to
  // the item), then item.click() — so it fails under the old handler and
  // passes only because the container-level blur now checks relatedTarget.
  it("fires New chat and Edit bot from the ⋯ menu despite the trigger losing focus to the item", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "bot_2" }, { rpc: RPC });

    const menuButton = await slot.findByLabelText("More actions");
    menuButton.focus();
    menuButton.click();
    const newChatItem = await slot.findByText("New chat");
    fireEvent.focusOut(menuButton, { relatedTarget: newChatItem });
    expect(newChatItem.isConnected).toBe(true);
    newChatItem.click();

    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "bots",
      options: { subPath: "bot_2/new" },
    });

    const reopened = await slot.findByLabelText("More actions");
    reopened.focus();
    reopened.click();
    const editBotItem = await slot.findByText("Edit bot");
    fireEvent.focusOut(reopened, { relatedTarget: editBotItem });
    expect(editBotItem.isConnected).toBe(true);
    editBotItem.click();

    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "bots",
      options: { subPath: "bot_2/edit" },
    });
    slot.lifecycle.unmount();
  });

  it("opens the ⋯ menu, confirms Delete bot, and calls deleteBot", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "bot_2" }, { rpc: RPC });

    const menuButton = await slot.findByLabelText("More actions");
    menuButton.focus();
    menuButton.click();
    const deleteItem = await slot.findByText("Delete bot");

    // The bug this pins: focus leaves the trigger for the menu item on
    // mousedown, and the old handler closed the menu right then — unmounting
    // the item before its click could land. jsdom's .focus() alone doesn't
    // reproduce that, so dispatch the focusout React actually listens for and
    // assert the item SURVIVES it before clicking.
    fireEvent.focusOut(menuButton, { relatedTarget: deleteItem });
    expect(deleteItem.isConnected).toBe(true);
    deleteItem.click();

    await slot.findByText("Delete Builder?");
    (await slot.findByRole("button", { name: "Delete" })).click();

    await waitFor(() => {
      const deleteCall = slot.inspection.rpcCalls.find(
        (call) => call.method === "deleteBot",
      );
      expect(deleteCall?.input).toEqual({ botId: "bot_2" });
    });
    await waitFor(() =>
      expect(slot.inspection.navigateCalls).toContainEqual({
        method: "toPluginPanel",
        path: "bots",
        options: { subPath: "", replace: true },
      }),
    );
    slot.lifecycle.unmount();
  });

  it("clamps instructions with a working Show more / Show less toggle", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "bot_2" }, { rpc: RPC });

    const showMore = await slot.findByRole("button", { name: "Show more" });
    showMore.click();
    await slot.findByRole("button", { name: "Show less" });
    slot.lifecycle.unmount();
  });

  it("renders the header subtitle only when the bot has provider, model, or reasoning to show", async () => {
    const panel = await loadPanel();
    const configured = renderSlot(panel, { subPath: "bot_2" }, { rpc: RPC });
    const configuredHeader = (
      await configured.findByLabelText("Edit bot settings")
    ).parentElement!;
    expect(configuredHeader.textContent).toContain("codex · gpt-5.5 · medium");
    configured.lifecycle.unmount();

    // bot_3 is a draft with an empty providerId, an empty model, and a null
    // reasoningLevel, so the joined subtitle must collapse away entirely
    // rather than rendering the separators around missing parts.
    const draft = renderSlot(panel, { subPath: "bot_3" }, { rpc: RPC });
    const draftHeader = (
      await draft.findByLabelText("Edit bot settings")
    ).parentElement!;
    expect(draftHeader.textContent).not.toContain("·");
    draft.lifecycle.unmount();
  });

  it("exposes the ⋯ menu as an ARIA menu, with aria-expanded tracking open state", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "bot_2" }, { rpc: RPC });

    const menuButton = await slot.findByLabelText("More actions");
    expect(menuButton.getAttribute("aria-haspopup")).toBe("menu");
    expect(menuButton.getAttribute("aria-expanded")).toBe("false");
    expect(slot.queryByRole("menu")).toBeNull();

    menuButton.click();

    await slot.findByRole("menu");
    expect(menuButton.getAttribute("aria-expanded")).toBe("true");
    expect(
      slot.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["New chat", "Edit bot", "Delete bot"]);

    slot.lifecycle.unmount();
  });

  it("confirms before deleting a draft from the editor", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "bot_3/edit" }, { rpc: RPC });

    (await slot.findByText("Delete draft")).click();
    expect(
      slot.inspection.rpcCalls.some((call) => call.method === "deleteBot"),
    ).toBe(false);

    await slot.findByText("Delete Untitled bot?");
    (await slot.findByRole("button", { name: "Cancel" })).click();
    await waitFor(() =>
      expect(slot.queryByText("Delete Untitled bot?")).toBeNull(),
    );
    expect(
      slot.inspection.rpcCalls.some((call) => call.method === "deleteBot"),
    ).toBe(false);

    (await slot.findByText("Delete draft")).click();
    await slot.findByText("Delete Untitled bot?");
    (await slot.findByRole("button", { name: "Delete" })).click();

    await waitFor(() => {
      const deleteCall = slot.inspection.rpcCalls.find(
        (call) => call.method === "deleteBot",
      );
      expect(deleteCall?.input).toEqual({ botId: "bot_3" });
    });
    slot.lifecycle.unmount();
  });

  it("clears the model and keeps Publish disabled when the picked provider has no models", async () => {
    // Radix's Select needs these; jsdom ships neither.
    Element.prototype.scrollIntoView = () => {};
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};

    const panel = await loadPanel();
    const slot = renderSlot(
      panel,
      { subPath: "bot_4/edit" },
      {
        rpc: {
          ...RPC,
          getBot: () => ({ bot: BOT_NAMED_DRAFT }),
          listOptions: () => ({
            providers: [
              { id: "codex", displayName: "Codex", available: true },
              { id: "vacant", displayName: "Vacant", available: true },
            ],
            projects: [],
            personalProjectId: null,
          }),
          // Settled-and-empty, not pending: the editor must tell "this
          // provider offers nothing" apart from "still loading".
          listModels: (input: unknown) => {
            const { providerId } = input as { providerId: string };
            if (providerId === "vacant") return { models: [] };
            return RPC.listModels();
          },
        },
      },
    );

    const providerTrigger = await slot.findByLabelText("Provider");
    providerTrigger.focus();
    fireEvent.keyDown(providerTrigger, { key: "ArrowDown" });
    fireEvent.click(await slot.findByText("Vacant"));

    await waitFor(() =>
      expect(slot.getByLabelText("Model").textContent).toBe("Select a model"),
    );
    expect(
      slot.getByText("Publish bot").closest("button")!.disabled,
    ).toBe(true);

    slot.lifecycle.unmount();
  });

  it("shows a setup callout instead of a composer for a draft bot", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "bot_3" }, { rpc: RPC });

    await slot.findByText("Finish setting up this bot");
    await slot.findByText("Set up →");
    expect(slot.queryByTestId("bb-new-thread-composer")).toBeNull();
    slot.lifecycle.unmount();
  });

  it("seeds the host new-thread composer and starts a chat from BotHome", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "bot_2" }, { rpc: RPC });

    const composer = await slot.findByTestId("bb-new-thread-composer");
    expect(composer.getAttribute("data-default-provider-id")).toBe("codex");
    expect(composer.getAttribute("data-default-model")).toBe("gpt-5.5");
    expect(composer.getAttribute("data-default-reasoning-level")).toBe(
      "medium",
    );

    (await slot.findByTestId("bb-new-thread-composer-submit")).click();

    await waitFor(() =>
      expect(slot.inspection.navigateCalls).toContainEqual({
        method: "toPluginPanel",
        path: "bots",
        options: { subPath: "bot_2/thr_from_home" },
      }),
    );
    const startChatCall = slot.inspection.rpcCalls.find(
      (call) => call.method === "startChat",
    );
    expect(startChatCall?.input).toMatchObject({
      botId: "bot_2",
      request: { providerId: "codex", model: "gpt-5.5" },
    });
    slot.lifecycle.unmount();
  });

  it("opens the emoji picker from the avatar and swaps the icon", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "bot_1/edit" }, { rpc: RPC });

    // bot_1's seeded emoji is "🏴‍☠️"; pick a different curated emoji from the
    // grid. "🦉" isn't used by any bot in RAIL_BOTS, so it can't collide with
    // an avatar rendered in the rail alongside the editor.
    const trigger = await slot.findByLabelText("Change icon");
    expect(slot.queryByText("Choose an icon")).toBeNull();

    fireEvent.click(trigger);
    await slot.findByText("Choose an icon");

    const target = slot.getByRole("button", { name: "🦉" });
    fireEvent.click(target);

    // Picking closes the dialog...
    expect(slot.queryByText("Choose an icon")).toBeNull();
    // ...and the avatar now shows the picked emoji.
    expect(slot.getByText("🦉").isConnected).toBe(true);

    slot.lifecycle.unmount();
  });

  it("autosaves a picked emoji as an emoji patch after the debounce", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "bot_1/edit" }, { rpc: RPC });

    const trigger = await slot.findByLabelText("Change icon");
    fireEvent.click(trigger);
    await slot.findByText("Choose an icon");

    // Install fake timers right before the state change that arms the
    // debounce, so the effect's setTimeout(..., AUTOSAVE_DELAY_MS) call is
    // captured by the fake clock instead of a real one.
    vi.useFakeTimers();
    try {
      const target = slot.getByRole("button", { name: "🦉" });
      fireEvent.click(target);

      await vi.advanceTimersByTimeAsync(600);

      const saveCall = slot.inspection.rpcCalls.find(
        (call) => call.method === "saveBot",
      );
      expect(saveCall?.input).toMatchObject({
        botId: "bot_1",
        patch: { emoji: "🦉" },
      });
    } finally {
      vi.useRealTimers();
    }

    slot.lifecycle.unmount();
  });

  it("auto-applies a single emoji typed into the custom field without clicking Use, and autosaves it as an emoji patch", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "bot_1/edit" }, { rpc: RPC });

    const trigger = await slot.findByLabelText("Change icon");
    fireEvent.click(trigger);
    await slot.findByText("Choose an icon");

    vi.useFakeTimers();
    try {
      const customInput = slot.getByLabelText("Any other emoji");
      fireEvent.change(customInput, { target: { value: "🦉" } });

      // Auto-applied immediately — no "Use" click — and the dialog closes.
      expect(slot.queryByText("Choose an icon")).toBeNull();
      expect(slot.getByText("🦉").isConnected).toBe(true);

      await vi.advanceTimersByTimeAsync(600);

      const saveCall = slot.inspection.rpcCalls.find(
        (call) => call.method === "saveBot",
      );
      expect(saveCall?.input).toMatchObject({
        botId: "bot_1",
        patch: { emoji: "🦉" },
      });
    } finally {
      vi.useRealTimers();
    }

    slot.lifecycle.unmount();
  });

  it("still has a working Shuffle icon button that lands on a curated emoji", async () => {
    const panel = await loadPanel();
    const slot = renderSlot(panel, { subPath: "bot_1/edit" }, { rpc: RPC });

    await slot.findByLabelText("Change icon");
    const shuffle = await slot.findByText("Shuffle icon");
    fireEvent.click(shuffle);

    const avatar = slot.getByLabelText("Change icon").querySelector("span[aria-hidden]");
    expect(avatar).not.toBeNull();
    expect(EMOJIS).toContain(avatar!.textContent);

    slot.lifecycle.unmount();
  });
});
