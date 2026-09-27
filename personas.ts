// Pure persona logic — no BB handle, no I/O. Everything here is unit-testable
// without a running server.

/** BB truncates instruction contributions at 4096 characters. */
export const INSTRUCTION_LIMIT = 4096;

/**
 * Budget for the user's own instruction text, leaving room for the persona
 * wrapper renderPersonaInstructions puts around it.
 */
export const MAX_INSTRUCTIONS = 3500;

export const MAX_NAME = 60;

/**
 * The curated emoji set, grouped for the picker UI. Order within and across
 * groups matches the flat EMOJIS list below, which is derived from this so
 * the two can never drift apart.
 */
export const EMOJI_GROUPS = [
  {
    label: "Characters",
    emojis: ["🤖", "🧠", "🦉", "🐙", "🦊", "🐳", "🦖", "🐝", "🦜", "🐸"],
  },
  {
    label: "Explore",
    emojis: ["🚀", "🛰️", "🧭", "🔭", "⚗️", "🧪", "📐", "🧵", "🪄", "🎯"],
  },
  {
    label: "Craft",
    emojis: ["🎩", "🎨", "🎬", "🎲", "🧩", "📚", "🗺️", "🏴‍☠️", "⚓", "🔮"],
  },
  {
    label: "Flavor",
    emojis: ["🍜", "🍕", "☕", "🌶️", "🍄", "🌵", "🌊", "🔥", "❄️", "⚡"],
  },
] as const;

export const EMOJIS: readonly string[] = EMOJI_GROUPS.flatMap(
  (group) => group.emojis,
);

const TINTS = [
  "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
] as const;

export const REASONING_LEVELS = [
  "none", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode",
] as const;

export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

export type PersonaStatus = "draft" | "published";

export interface Persona {
  id: string;
  name: string;
  emoji: string;
  instructions: string;
  providerId: string;
  model: string;
  reasoningLevel: ReasoningLevel | null;
  /** null = projectless chat in BB's personal project. */
  projectId: string | null;
  status: PersonaStatus;
  createdAt: number;
  updatedAt: number;
}

/** The prompt types a pool entry can carry; "text" is the only one so far. */
export const PROMPT_TYPES = ["text"] as const;

export type PromptType = (typeof PROMPT_TYPES)[number];

/**
 * Per-prompt text budget. Same 3500 the old single-instructions field had, so
 * one prompt can carry everything a pre-pool persona could.
 */
export const MAX_PROMPT_TEXT = MAX_INSTRUCTIONS;

/** How much of a prompt's text a pool entry displays before its ellipsis. */
export const PROMPT_PREVIEW_LIMIT = 24;

/** One entry in a persona's prompt pool. Each prompt belongs to one persona. */
export interface PersonaPrompt {
  id: string;
  personaId: string;
  type: PromptType;
  text: string;
  /** Insertion order within the persona's pool; ties break on createdAt. */
  position: number;
  createdAt: number;
  updatedAt: number;
}

export function pickEmoji(): string {
  return EMOJIS[Math.floor(Math.random() * EMOJIS.length)]!;
}

/**
 * Trims and validates a user-entered emoji. The 16-character bound mirrors
 * the savePersona RPC schema (server.ts: `z.string().min(1).max(16)`) so the UI
 * can reject an out-of-range value locally instead of round-tripping to the
 * server just to have it bounce.
 */
export function normalizeEmoji(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 16) return null;
  return trimmed;
}

/**
 * True when the trimmed value is exactly one user-perceived character
 * (grapheme cluster) — e.g. a single emoji, however many code points it's
 * built from ("🏴‍☠️", "👍🏽", "👩‍💻" all count as one). Used to auto-apply an
 * emoji inserted via the OS picker without requiring an explicit "Use" click.
 */
export function isSingleEmoji(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  // Being one grapheme is not enough — "a" is one grapheme too, and auto-apply
  // would turn the first letter someone types into the persona's icon. Require the
  // cluster to actually be emoji: a pictographic character, a regional-indicator
  // pair (flags), or a combining enclosing keycap ("1️⃣", which is not itself
  // Extended_Pictographic).
  if (!/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u{20E3}/u.test(trimmed)) {
    return false;
  }
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const segments = [...segmenter.segment(trimmed)];
    return segments.length === 1;
  }
  // Fallback heuristic when Intl.Segmenter is unavailable: count Unicode
  // code points (not UTF-16 code units) as a rough grapheme-cluster count.
  // This over-counts sequences joined by ZWJ/variation selectors/skin-tone
  // modifiers, so it's a coarser approximation than Intl.Segmenter.
  return [...trimmed].length === 1;
}

/**
 * The human-readable hint naming how to open the OS emoji picker, given the
 * platform string and touch-capability the caller already read from
 * `navigator`. Pure — never reads globals itself, so it's trivial to test.
 */
export function emojiPickerHint(input: {
  platform: string;
  isTouch: boolean;
}): string {
  if (input.isTouch) return "Tap the emoji key on your keyboard";
  const platform = input.platform.toLowerCase();
  if (platform.includes("mac") || platform.includes("iphone") || platform.includes("ipad")) {
    return "Press ⌃⌘Space for your system emoji picker";
  }
  if (platform.includes("win")) {
    return "Press Win + . for your system emoji picker";
  }
  return "Use your system emoji picker";
}

/** Stable non-cryptographic hash, used only to pick a display tint. */
function hash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(result);
}

/** Deterministic avatar tint classes for a persona id. */
export function tintFor(personaId: string): string {
  return TINTS[hash(personaId) % TINTS.length]!;
}

export function newPersonaId(): string {
  // The "persona_" prefix keeps ids from colliding with the "new" route word.
  return `persona_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function newPromptId(): string {
  return `prompt_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function clampInstructions(instructions: string): string {
  return instructions.trim().slice(0, MAX_INSTRUCTIONS);
}

/** Trims and length-bounds a prompt's text the way savePersona did for instructions. */
export function clampPromptText(text: string): string {
  return text.trim().slice(0, MAX_PROMPT_TEXT);
}

/**
 * The pool-entry display: the first 24 characters, with an ellipsis only
 * when the text actually overflows.
 */
export function promptPreview(text: string): string {
  return text.length > PROMPT_PREVIEW_LIMIT
    ? `${text.slice(0, PROMPT_PREVIEW_LIMIT)}…`
    : text;
}

/**
 * The uniqueness key the pool enforces: one persona can never hold two
 * prompts whose first 24 characters are identical.
 */
export function promptConflictKey(text: string): string {
  return clampPromptText(text).slice(0, PROMPT_PREVIEW_LIMIT);
}

/**
 * True when `text` collides with any of `existing` on the first 24
 * characters. Scope is a single persona's pool — the same text on two
 * different personas is fine.
 */
export function hasPromptConflict(
  existing: readonly string[],
  text: string,
): boolean {
  const key = promptConflictKey(text);
  return existing.some((candidate) => promptConflictKey(candidate) === key);
}

/** All of a persona's prompt texts joined into the block its chats receive. */
export function joinedPromptText(prompts: readonly PersonaPrompt[]): string {
  return prompts
    .map((prompt) => prompt.text)
    .filter((text) => text.length > 0)
    .join("\n\n");
}

/** Single-line preview of a persona's instructions for list cards. */
export function previewInstructions(instructions: string): string {
  const collapsed = instructions.replace(/\s+/g, " ").trim();
  return collapsed.length > 0 ? collapsed : "No instructions yet.";
}

/** The editor autosaves drafts with a blank name, so list cards need a fallback. */
export function displayName(persona: Persona): string {
  return persona.name.trim() || "Untitled persona";
}

/**
 * Human-readable reasons a draft can't be published yet; [] means it can.
 * Publish-time is where validation now lives — savePersona autosaves a
 * half-typed persona on every keystroke, so it can't require these fields.
 */
export function draftBlockers(persona: Persona): string[] {
  const blockers: string[] = [];
  if (persona.name.trim().length === 0) blockers.push("a name");
  if (persona.providerId.length === 0) blockers.push("a provider");
  if (persona.model.length === 0) blockers.push("a model");
  return blockers;
}

/**
 * The persona block BB injects into every turn of a persona's threads. Kept under
 * INSTRUCTION_LIMIT by construction: MAX_INSTRUCTIONS plus this wrapper.
 */
export function renderPersonaInstructions(persona: Persona): string {
  return [
    `# Custom persona: ${persona.name}`,
    "",
    `You are running as a custom persona named "${persona.name}" that the user built.`,
    "The instructions below are the user's standing configuration for this persona.",
    "Follow them in every response in this conversation, including later turns.",
    "They take precedence over your default response style. If they conflict",
    "with a specific request the user makes later, follow the later request.",
    "",
    "<persona-instructions>",
    persona.instructions,
    "</persona-instructions>",
  ].join("\n");
}

export type Route =
  | { view: "list" }
  | { view: "new" }
  | { view: "persona"; personaId: string }
  | { view: "edit"; personaId: string }
  | { view: "newChat"; personaId: string }
  | { view: "chat"; personaId: string; threadId: string };

/**
 * Maps a navPanel subPath onto a view. Unknown shapes fall back to the list.
 * A second segment of "new" is the fresh-chat route rather than a thread id —
 * real thread ids are `thr_*`, so there's no collision.
 */
export function parseRoute(subPath: string): Route {
  const segments = subPath.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) return { view: "list" };
  const [first, second] = segments;
  if (first === "new") return { view: "new" };
  if (first === undefined) return { view: "list" };
  if (second === undefined) return { view: "persona", personaId: first };
  if (second === "edit") return { view: "edit", personaId: first };
  if (second === "new") return { view: "newChat", personaId: first };
  return { view: "chat", personaId: first, threadId: second };
}

export function routeToSubPath(route: Route): string {
  switch (route.view) {
    case "list":
      return "";
    case "new":
      return "new";
    case "persona":
      return route.personaId;
    case "edit":
      return `${route.personaId}/edit`;
    case "newChat":
      return `${route.personaId}/new`;
    case "chat":
      return `${route.personaId}/${route.threadId}`;
  }
}

/** A row as stored in SQLite (snake_case, integers for timestamps). */
export interface PersonaRow {
  id: string;
  name: string;
  emoji: string;
  instructions: string;
  provider_id: string;
  model: string;
  reasoning_level: string | null;
  project_id: string | null;
  status: string;
  created_at: number;
  updated_at: number;
}

/** A prompt-pool row as stored in SQLite (snake_case). */
export interface PersonaPromptRow {
  id: string;
  persona_id: string;
  type: string;
  text: string;
  position: number;
  created_at: number;
  updated_at: number;
}

export function rowToPrompt(row: PersonaPromptRow): PersonaPrompt {
  return {
    id: row.id,
    personaId: row.persona_id,
    // "text" is the only prompt type so far, so any stored value reads as
    // one rather than flowing uncaught into the prompt RPCs' zod schemas.
    type: "text",
    text: row.text,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The subset of ChatSchema (server.ts) that sortChats needs to order a list. */
export interface ChatSortable {
  pinnedAt: number | null;
  updatedAt: number;
}

/**
 * Orders a persona's active chats for the list: pinned chats first (most
 * recently pinned on top), then everything else by most-recently-updated.
 * Exported as a pure helper — separate from listChats's I/O — so the
 * ordering rule is unit-testable without spinning up a fake plugin host.
 */
export function sortChats<T extends ChatSortable>(chats: readonly T[]): T[] {
  return [...chats].sort((a, b) => {
    const aPinned = a.pinnedAt !== null;
    const bPinned = b.pinnedAt !== null;
    if (aPinned && bPinned) return b.pinnedAt! - a.pinnedAt!;
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

export function rowToPersona(row: PersonaRow): Persona {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    instructions: row.instructions,
    providerId: row.provider_id,
    model: row.model,
    // Any unrecognised stored value reads as unset rather than flowing
    // uncaught into the UI and the savePersona RPC's zod schema.
    reasoningLevel: REASONING_LEVELS.includes(row.reasoning_level as ReasoningLevel)
      ? (row.reasoning_level as ReasoningLevel)
      : null,
    projectId: row.project_id,
    // Any unexpected stored value reads as published rather than stranding
    // a persona as an un-publishable draft.
    status: row.status === "draft" ? "draft" : "published",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
