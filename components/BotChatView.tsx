import { ThreadChat, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { BotHeader } from "@/components/BotHome";
import { useBotsRpc, useQuery } from "@/components/use-query";
import { PANEL_PATH } from "@/components/panel-path";

export function BotChatView({
  botId,
  threadId,
  onBack,
}: {
  botId: string;
  threadId: string;
  onBack?: () => void;
}) {
  const rpc = useBotsRpc();
  const navigate = useBbNavigate();
  const { data } = useQuery(() => rpc.call("getBot", { botId }), `chat:${botId}`);
  const bot = data?.bot ?? null;

  // Deleting a bot leaves its chats intact (they just stop receiving the
  // persona), so this stays reachable from an already-open chat.
  async function remove() {
    if (bot === null) return;
    try {
      await rpc.call("deleteBot", { botId });
      toast.success(`Deleted ${bot.name}`);
      navigate.toPluginPanel(PANEL_PATH, { subPath: "", replace: true });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {bot === null ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
          {onBack === undefined ? null : (
            <button
              type="button"
              aria-label="Back"
              onClick={onBack}
              className="rounded-md p-1.5 text-sm hover:bg-accent"
            >
              ←
            </button>
          )}
          <span className="truncate text-sm font-medium">Bot</span>
        </div>
      ) : (
        <BotHeader
          bot={bot}
          onBack={onBack}
          onSettings={() =>
            navigate.toPluginPanel(PANEL_PATH, { subPath: `${botId}/edit` })
          }
          onNewChat={() =>
            navigate.toPluginPanel(PANEL_PATH, { subPath: `${botId}/new` })
          }
          onEditBot={() =>
            navigate.toPluginPanel(PANEL_PATH, { subPath: `${botId}/edit` })
          }
          onDeleteBot={() => void remove()}
          onGoToBotPage={() =>
            navigate.toPluginPanel(PANEL_PATH, { subPath: botId })
          }
        />
      )}
      <div className="min-h-0 flex-1">
        <ThreadChat threadId={threadId} variant="full" layout="contained" />
      </div>
    </div>
  );
}
