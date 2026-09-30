import { useEffect, useRef, useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Icon } from "@/components/ui/icon";
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
import {
  DocPickerDialog,
  FloatingNotePickerDialog,
  type AttachableDoc,
  type AttachableNote,
} from "@/components/PromptSourcePicker";
import { usePersonasRpc, useQuery } from "@/components/use-query";
import { PANEL_PATH } from "@/components/panel-path";
import { DOCS_PLUGIN_ID } from "@/plugin-health";
import {
  clampPromptText,
  displayName,
  draftBlockers,
  escapeHtml,
  MAX_NAME,
  MAX_PROMPT_TEXT,
  pickEmoji,
  promptPreview,
  tintFor,
  type Persona,
  type PersonaColor,
  type PersonaPrompt,
  type ReasoningLevel,
} from "@/personas";

const NO_PROJECT = "__none__";

/** How long a run of edits sits idle before autosave sends it. */
const AUTOSAVE_DELAY_MS = 600;

/** The subset of `Persona` this form edits, in the shape autosave diffs against. */
interface DraftFields {
  name: string;
  emoji: string;
  color: PersonaColor | null;
  providerId: string;
  model: string;
  reasoningLevel: ReasoningLevel | null;
  projectId: string; // NO_PROJECT sentinel or a real project id
}

type PersonaPatch = Partial<{
  name: string;
  emoji: string;
  color: PersonaColor | null;
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
  if (current.color !== base.color) {
    patch.color = current.color;
    nextBase.color = current.color;
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
  // existing values arrive together instead of in a waterfall. Plugin health
  // rides along so the + Add split button knows which source pickers exist.
  const { data, error, reload } = useQuery(
    () =>
      Promise.all([
        rpc.call("listOptions", null),
        rpc.call("getPersona", { personaId }),
        rpc.call("getPluginHealth", null),
      ]),
    `editor:${personaId}`,
  );

  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(pickEmoji);
  const [color, setColor] = useState<PersonaColor | null>(null);
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
  // Prompt-pool form state. `editingPromptId` is non-null while the textarea
  // holds an existing prompt being edited rather than a fresh one.
  const [promptDraft, setPromptDraft] = useState("");
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [isPoolBusy, setIsPoolBusy] = useState(false);
  // The + Add dropdown: open while its menu shows, holding the picker the
  // user asked for ("note" / "doc") once a menu item is picked.
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [picker, setPicker] = useState<"note" | "doc" | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);

  const options = data?.[0] ?? null;
  const persona = data?.[1].persona ?? null;
  const health = data?.[2] ?? null;

  // Same one-plugin rule the server-side source RPCs gate on; the menu only
  // offers a picker whose plugin is actually there.
  const floatingNotesAvailable = health?.floatingNotesAvailable ?? false;
  const docsAvailable =
    health?.tools.find((tool) => tool.id === DOCS_PLUGIN_ID)?.available ??
    false;

  // The baseline autosave diffs new edits against — the fields the server
  // actually has. Deliberately separate from form state: seeding a fresh
  // draft's provider/model below leaves this at the pre-seed (empty) value,
  // so the seed itself still reads as a real change and gets autosaved.
  const savedRef = useRef<DraftFields | null>(null);
  const draftRef = useRef<DraftFields>({
    name,
    emoji,
    color,
    providerId,
    model,
    reasoningLevel,
    projectId,
  });
  draftRef.current = {
    name,
    emoji,
    color,
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
    setColor(persona.color);
    setProviderId(seededProviderId);
    setModel(persona.model);
    setReasoningLevel(persona.reasoningLevel);
    setProjectId(persona.projectId ?? NO_PROJECT);
    // The real baseline: what the server has, not the provider fallback
    // above. That fallback still needs to autosave once seeding lands.
    savedRef.current = {
      name: persona.name,
      emoji: persona.emoji,
      color: persona.color,
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
  }, [isSeeded, name, emoji, color, providerId, model, reasoningLevel, projectId]);

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

  // The + Add dropdown is a plain positioned menu, so it owns its own
  // dismissal: any pointer-down outside it, or Escape, closes it.
  useEffect(() => {
    if (!addMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (addMenuRef.current?.contains(event.target as Node)) return;
      setAddMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAddMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [addMenuOpen]);

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
  const prompts = persona.prompts;
  // Whether the + Add dropdown has anything to offer at all.
  const hasPromptSources = floatingNotesAvailable || docsAvailable;

  // Blockers reflect what's on screen right now, not the last save that
  // landed — otherwise Publish would only enable after a round trip.
  const currentPersona: Persona = {
    ...persona,
    name: name.trim(),
    emoji,
    color,
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

  // -- Prompt pool -----------------------------------------------------------

  function startEditPrompt(prompt: PersonaPrompt): void {
    setEditingPromptId(prompt.id);
    setPromptDraft(prompt.text);
    setPromptError(null);
  }

  function resetPromptForm(): void {
    setEditingPromptId(null);
    setPromptDraft("");
    setPromptError(null);
  }

  async function submitPrompt(): Promise<void> {
    const text = clampPromptText(promptDraft);
    if (text.length === 0) return;
    setIsPoolBusy(true);
    try {
      if (editingPromptId === null) {
        await rpc.call("addPersonaPrompt", { personaId, type: "text", text });
      } else {
        await rpc.call("updatePersonaPrompt", {
          personaId,
          promptId: editingPromptId,
          text,
        });
      }
      resetPromptForm();
      reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsPoolBusy(false);
    }
  }

  async function removePrompt(promptId: string): Promise<void> {
    setIsPoolBusy(true);
    try {
      await rpc.call("removePersonaPrompt", { personaId, promptId });
      if (editingPromptId === promptId) resetPromptForm();
      reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsPoolBusy(false);
    }
  }

  // -- Prompt-pool sources ----------------------------------------------------

  /** Reports a rejected attachment: inline under the pool, and as a toast. */
  function reportPoolError(message: string): void {
    setPromptError(message);
    toast.error(message);
  }

  /**
   * Shared tail of the Doc attachment path: add the (sanitized) text as a
   * plain text prompt. The picker is already closed by the time this runs —
   * selecting an entry is what dismisses it. No uniqueness rule: the pool is
   * the user's to curate.
   */
  async function addPoolText(sourceLabel: string, text: string): Promise<void> {
    const clamped = clampPromptText(text);
    if (clamped.length === 0) {
      reportPoolError(`That ${sourceLabel} is empty.`);
      return;
    }
    setIsPoolBusy(true);
    try {
      await rpc.call("addPersonaPrompt", { personaId, type: "text", text: clamped });
      reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsPoolBusy(false);
    }
  }

  /**
   * Attaches a Floating Note as a live reference, not a copy: the pool entry
   * keeps the note's durable id, and its displayed/injected text always
   * reads the note's current body. Selecting the note is what dismisses the
   * picker.
   */
  function attachNote(note: AttachableNote): void {
    setPicker(null);
    setIsPoolBusy(true);
    rpc
      .call("addPersonaPrompt", {
        personaId,
        type: "note",
        noteId: note.id,
      })
      .then(() => reload())
      .catch((cause) => {
        toast.error(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setIsPoolBusy(false));
  }

  async function attachDoc(doc: AttachableDoc): Promise<void> {
    setPicker(null);
    setIsPoolBusy(true);
    let content: string;
    try {
      ({ content } = await rpc.call("readDoc", {
        vaultId: doc.vaultId,
        path: doc.path,
      }));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
      setIsPoolBusy(false);
      return;
    }
    setIsPoolBusy(false);
    // Doc content is free to carry raw HTML; escaping it here keeps the pool
    // entry (and everything downstream of the prompt text) plain text.
    await addPoolText("document", escapeHtml(content));
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
          <EmojiPicker
            value={emoji}
            onChange={setEmoji}
            color={color}
            onColorChange={setColor}
            autoTint={tintFor(persona.id)}
          >
            <button
              type="button"
              aria-label="Change icon"
              className="cursor-pointer rounded-lg hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <PersonaAvatar personaId={persona.id} emoji={emoji} color={color} />
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

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium">Prompt pool</span>
          <span className="text-xs text-muted-foreground">
            {prompts.length === 0
              ? "Empty"
              : `${prompts.length} prompt${prompts.length === 1 ? "" : "s"}`}
          </span>
        </div>
        {prompts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No prompts yet — add one below.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {prompts.map((prompt) => (
              <li key={prompt.id} className="flex items-center gap-2 px-3 py-2">
                {prompt.type === "note" ? (
                  // A note entry is a live pointer, not prose: it renders the
                  // note's current body (resolved server-side) and can only be
                  // removed — never edited, or it would drift from its note.
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-secondary-foreground">
                      Floating Note
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate text-sm"
                      title={prompt.text}
                    >
                      {promptPreview(prompt.text)}
                    </span>
                  </span>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-sm" title={prompt.text}>
                    {promptPreview(prompt.text)}
                  </span>
                )}
                {prompt.type === "note" ? null : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isPoolBusy}
                    aria-label={`Edit prompt: ${promptPreview(prompt.text)}`}
                    onClick={() => startEditPrompt(prompt)}
                  >
                    Edit
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  disabled={isPoolBusy}
                  aria-label={`Remove prompt: ${promptPreview(prompt.text)}`}
                  onClick={() => void removePrompt(prompt.id)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Textarea
          id="persona-prompt-text"
          aria-label="Text prompt"
          value={promptDraft}
          rows={4}
          maxLength={MAX_PROMPT_TEXT}
          placeholder="A standing prompt, e.g. Always answer in exaggerated pirate speak."
          onChange={(event) => {
            setPromptDraft(event.target.value);
            setPromptError(null);
          }}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {promptDraft.length} / {MAX_PROMPT_TEXT}
          </span>
          <div className="flex items-center gap-2">
            {editingPromptId !== null ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={isPoolBusy}
                onClick={resetPromptForm}
              >
                Cancel
              </Button>
            ) : null}
            {editingPromptId !== null || !hasPromptSources ? (
              <Button
                type="button"
                size="sm"
                disabled={isPoolBusy || promptDraft.trim().length === 0}
                onClick={() => void submitPrompt()}
              >
                {editingPromptId !== null ? "Save prompt" : "+ Add"}
              </Button>
            ) : (
              // The + Add split button: the main half still adds the typed
              // text prompt; the dropdown half offers the source pickers.
              <div ref={addMenuRef} className="relative inline-flex">
                <Button
                  type="button"
                  size="sm"
                  className="rounded-r-none"
                  disabled={isPoolBusy || promptDraft.trim().length === 0}
                  onClick={() => void submitPrompt()}
                >
                  + Add
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-l-none border-l-0 px-2"
                  aria-label="More add options"
                  aria-haspopup="menu"
                  aria-expanded={addMenuOpen}
                  disabled={isPoolBusy}
                  onClick={() => setAddMenuOpen((open) => !open)}
                >
                  <Icon name="ChevronDown" aria-hidden />
                </Button>
                {addMenuOpen ? (
                  <div
                    role="menu"
                    aria-label="Add prompt from"
                    className="absolute right-0 top-full z-50 mt-1 w-44 rounded-md border border-border bg-background py-1 shadow-sm"
                  >
                    {floatingNotesAvailable ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="block w-full cursor-pointer px-3 py-1.5 text-left text-sm hover:bg-state-hover"
                        onClick={() => {
                          setAddMenuOpen(false);
                          setPicker("note");
                        }}
                      >
                        Add Floating Note
                      </button>
                    ) : null}
                    {docsAvailable ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="block w-full cursor-pointer px-3 py-1.5 text-left text-sm hover:bg-state-hover"
                        onClick={() => {
                          setAddMenuOpen(false);
                          setPicker("doc");
                        }}
                      >
                        Add Doc
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
        {promptError !== null ? (
          <p className="text-xs text-destructive">{promptError}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Every prompt in the pool is injected into each turn of this
            persona&apos;s chats. Floating Note entries inject the note&apos;s
            current content — edit the note and this persona follows.
          </p>
        )}
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

      {picker === "note" ? (
        <FloatingNotePickerDialog
          onSelectNote={attachNote}
          onClose={() => setPicker(null)}
        />
      ) : picker === "doc" ? (
        <DocPickerDialog
          onSelectDoc={(doc) => void attachDoc(doc)}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </div>
  );
}
