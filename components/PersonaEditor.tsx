import { useEffect, useRef, useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PersonaAvatar } from "@/components/PersonaAvatar";
import { EmojiPicker } from "@/components/EmojiPicker";
import { usePersonasRpc, useQuery } from "@/components/use-query";
import { PANEL_PATH } from "@/components/panel-path";
import {
  displayName,
  draftBlockers,
  MAX_NAME,
  pickEmoji,
  type Persona,
  type ReasoningLevel,
} from "@/personas";

const NO_PROJECT = "__none__";

/** How long a run of edits sits idle before autosave sends it. */
const AUTOSAVE_DELAY_MS = 600;

/** The subset of `Persona` this form edits, in the shape autosave diffs against. */
interface DraftFields {
  name: string;
  emoji: string;
  providerId: string;
  model: string;
  reasoningLevel: ReasoningLevel | null;
  projectId: string; // NO_PROJECT sentinel or a real project id
}

type PersonaPatch = Partial<{
  name: string;
  emoji: string;
  providerId: string;
  model: string;
  reasoningLevel: ReasoningLevel | null;
  projectId: string | null;
}>;

/** Only the fields that changed since `base`, plus the baseline they leave behind. */
function diffDraft(
  base: DraftFields,
  current: DraftFields,
): { patch: PersonaPatch; nextBase: DraftFields } | null {
  const patch: PersonaPatch = {};
  const nextBase = { ...base };
  const trimmedName = current.name.trim();
  if (trimmedName !== base.name) {
    patch.name = trimmedName;
    nextBase.name = trimmedName;
  }
  if (current.emoji !== base.emoji) {
    patch.emoji = current.emoji;
    nextBase.emoji = current.emoji;
  }
  if (current.providerId !== base.providerId) {
    patch.providerId = current.providerId;
    nextBase.providerId = current.providerId;
  }
  if (current.model !== base.model) {
    patch.model = current.model;
    nextBase.model = current.model;
  }
  if (current.reasoningLevel !== base.reasoningLevel) {
    patch.reasoningLevel = current.reasoningLevel;
    nextBase.reasoningLevel = current.reasoningLevel;
  }
  if (current.projectId !== base.projectId) {
    patch.projectId = current.projectId === NO_PROJECT ? null : current.projectId;
    nextBase.projectId = current.projectId;
  }
  if (Object.keys(patch).length === 0) return null;
  return { patch, nextBase };
}

export function PersonaEditor({ personaId }: { personaId: string }) {
  const rpc = usePersonasRpc();
  const navigate = useBbNavigate();

  // One round trip for everything the form needs, so the pickers and the
  // existing values arrive together instead of in a waterfall.
  const { data, error } = useQuery(
    () => Promise.all([rpc.call("listOptions"), rpc.call("getPersona", { personaId })]),
    `editor:${personaId}`,
  );

  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(pickEmoji);
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel | null>(null);
  const [projectId, setProjectId] = useState(NO_PROJECT);
  const [isSeeded, setIsSeeded] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );

  const options = data?.[0] ?? null;
  const persona = data?.[1].persona ?? null;

  // The baseline autosave diffs new edits against — the fields the server
  // actually has. Deliberately separate from form state: seeding a fresh
  // draft's provider/model below leaves this at the pre-seed (empty) value,
  // so the seed itself still reads as a real change and gets autosaved.
  const savedRef = useRef<DraftFields | null>(null);
  const draftRef = useRef<DraftFields>({
    name,
    emoji,
    providerId,
    model,
    reasoningLevel,
    projectId,
  });
  draftRef.current = {
    name,
    emoji,
    providerId,
    model,
    reasoningLevel,
    projectId,
  };

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // Serializes against any save already in flight, then sends whatever has
  // changed since the last confirmed save. A no-op if nothing has changed —
  // this is what both the debounce timer and every flush path call.
  async function runSave(): Promise<void> {
    while (savingRef.current !== null) {
      await savingRef.current.catch(() => {});
    }
    const base = savedRef.current;
    if (base === null) return;
    const diff = diffDraft(base, draftRef.current);
    if (diff === null) return;
    if (mountedRef.current) setSaveStatus("saving");
    const attempt = rpc
      .call("savePersona", { personaId, patch: diff.patch })
      .then(() => {
        savedRef.current = diff.nextBase;
        if (mountedRef.current) setSaveStatus("saved");
      })
      .catch((cause) => {
        if (mountedRef.current) setSaveStatus("error");
        toast.error(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        savingRef.current = null;
      });
    savingRef.current = attempt;
    await attempt;
  }

  function flushPendingSave(): void {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    void runSave();
  }

  // Seed once from the loaded record, then leave the form uncontrolled. The
  // row always exists by the time this mounts, so there is no "new persona"
  // branch here anymore — only a draft row with possibly-empty fields.
  useEffect(() => {
    if (options === null || persona === null || isSeeded) return;
    const seededProviderId =
      persona.providerId !== ""
        ? persona.providerId
        : (options.providers.find((provider) => provider.available) ??
            options.providers[0])?.id ?? "";
    setName(persona.name);
    setEmoji(persona.emoji);
    setProviderId(seededProviderId);
    setModel(persona.model);
    setReasoningLevel(persona.reasoningLevel);
    setProjectId(persona.projectId ?? NO_PROJECT);
    // The real baseline: what the server has, not the provider fallback
    // above. That fallback still needs to autosave once seeding lands.
    savedRef.current = {
      name: persona.name,
      emoji: persona.emoji,
      providerId: persona.providerId,
      model: persona.model,
      reasoningLevel: persona.reasoningLevel,
      projectId: persona.projectId ?? NO_PROJECT,
    };
    setIsSeeded(true);
  }, [options, persona, isSeeded]);

  const models = useQuery(
    () =>
      providerId === ""
        ? Promise.resolve({ models: [] })
        : rpc.call("listModels", { providerId }),
    `models:${providerId}`,
  );

  // Keep the model selection valid for the chosen provider. `models.data`
  // still holds the previous provider's list (or null, after a failed load)
  // until the new one resolves, so only a settled, non-null response is
  // treated as the truth about what this provider offers.
  const available = models.data?.models ?? [];
  useEffect(() => {
    if (models.isLoading || models.data === null) return;
    if (available.length === 0) {
      setModel("");
      setReasoningLevel(null);
      return;
    }
    if (available.some((candidate) => candidate.id === model)) return;
    const preferred =
      available.find((candidate) => candidate.isDefault) ?? available[0]!;
    setModel(preferred.id);
    setReasoningLevel(preferred.defaultReasoningEffort);
    // `model` is intentionally omitted: this only runs when the list changes.
  }, [available, models.isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce every field change into one autosave call. Skipped during the
  // initial seed pass above, or the loaded record would get overwritten with
  // the form's momentarily-empty starting state.
  useEffect(() => {
    if (!isSeeded) return;
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void runSave();
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSeeded, name, emoji, providerId, model, reasoningLevel, projectId]);

  // A user hitting Cmd-W (or Alt-Tab, etc.) moments after typing must not
  // lose that keystroke, so flush on both unmount and window blur — blur
  // fires well before any unload event a plugin panel could hook into.
  useEffect(() => {
    window.addEventListener("blur", flushPendingSave);
    return () => {
      window.removeEventListener("blur", flushPendingSave);
      flushPendingSave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error !== null) {
    return <p className="text-sm text-destructive">{error}</p>;
  }
  if (options === null) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (persona === null) {
    return <p className="text-sm text-muted-foreground">This persona was deleted.</p>;
  }

  const selectedModel = available.find((candidate) => candidate.id === model);
  const isDraft = persona.status === "draft";

  // Blockers reflect what's on screen right now, not the last save that
  // landed — otherwise Publish would only enable after a round trip.
  const currentPersona: Persona = {
    ...persona,
    name: name.trim(),
    emoji,
    providerId,
    model,
    reasoningLevel,
    projectId: projectId === NO_PROJECT ? null : projectId,
  };
  const blockers = isDraft ? draftBlockers(currentPersona) : [];
  const nameBlocked = isDraft && blockers.includes("a name");
  const modelBlocked = isDraft && blockers.includes("a model");

  async function publish() {
    setIsBusy(true);
    try {
      flushPendingSave();
      await runSave();
      await rpc.call("publishPersona", { personaId });
      toast.success("Persona published");
      navigate.toPluginPanel(PANEL_PATH, { subPath: personaId, replace: true });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsBusy(false);
    }
  }

  async function removeDraft() {
    setIsBusy(true);
    try {
      await rpc.call("deletePersona", { personaId });
      navigate.toPluginPanel(PANEL_PATH, { subPath: "", replace: true });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
      setIsBusy(false);
    }
  }

  async function saveAndClose() {
    setIsBusy(true);
    try {
      flushPendingSave();
      await runSave();
      navigate.toPluginPanel(PANEL_PATH, { subPath: personaId, replace: true });
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium">{isDraft ? "Set up persona" : "Edit persona"}</h2>
        <span className="text-xs text-muted-foreground">
          {saveStatus === "saving"
            ? "Saving…"
            : saveStatus === "saved"
              ? "Saved ✓"
              : saveStatus === "error"
                ? "Save failed — retrying on next edit"
                : null}
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="persona-name">Name</Label>
          {nameBlocked ? <span className="text-xs text-destructive">Required</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <EmojiPicker value={emoji} onChange={setEmoji}>
            <button
              type="button"
              aria-label="Change icon"
              className="cursor-pointer rounded-lg hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <PersonaAvatar personaId={persona.id} emoji={emoji} />
            </button>
          </EmojiPicker>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setEmoji(pickEmoji())}
          >
            Shuffle icon
          </Button>
          <Input
            id="persona-name"
            value={name}
            maxLength={MAX_NAME}
            placeholder="Pirate"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="persona-provider">Provider</Label>
          <Select value={providerId} onValueChange={setProviderId}>
            <SelectTrigger id="persona-provider">
              <SelectValue placeholder="Select a provider" />
            </SelectTrigger>
            <SelectContent>
              {options.providers.map((provider) => (
                <SelectItem
                  key={provider.id}
                  value={provider.id}
                  disabled={!provider.available}
                >
                  {provider.displayName}
                  {provider.available ? "" : " (unavailable)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="persona-model">Model</Label>
            {modelBlocked ? (
              <span className="text-xs text-destructive">Required</span>
            ) : null}
          </div>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger id="persona-model">
              <SelectValue placeholder="Select a model" />
            </SelectTrigger>
            <SelectContent>
              {available.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {candidate.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="persona-reasoning">Reasoning</Label>
          <Select
            value={reasoningLevel ?? ""}
            onValueChange={(next) => setReasoningLevel(next as ReasoningLevel)}
          >
            <SelectTrigger id="persona-reasoning">
              <SelectValue placeholder="Default" />
            </SelectTrigger>
            <SelectContent>
              {(selectedModel?.reasoningEfforts ?? []).map((effort) => (
                <SelectItem key={effort} value={effort}>
                  {effort}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="persona-project">Project</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger id="persona-project">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_PROJECT}>No project — just chat</SelectItem>
              {options.projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {isDraft ? (
          <>
            <span
              title={blockers.length > 0 ? `Missing: ${blockers.join(", ")}` : undefined}
            >
              <Button disabled={blockers.length > 0 || isBusy} onClick={() => void publish()}>
                Publish persona
              </Button>
            </span>
            <Button
              variant="ghost"
              className="text-destructive"
              disabled={isBusy}
              onClick={() => setDeleteDialogOpen(true)}
            >
              Delete draft
            </Button>
            {/* Deleting is irreversible, so it always goes through this
                confirmation rather than firing straight off the click. */}
            <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete {displayName(currentPersona)}?</DialogTitle>
                  <DialogDescription>
                    This draft was never published, so nothing else changes.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Cancel</Button>
                  </DialogClose>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setDeleteDialogOpen(false);
                      void removeDraft();
                    }}
                  >
                    Delete
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        ) : (
          <Button disabled={isBusy} onClick={() => void saveAndClose()}>
            Save
          </Button>
        )}
      </div>
    </div>
  );
}
