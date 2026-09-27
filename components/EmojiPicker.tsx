import { useMemo, useState } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { EMOJI_GROUPS, emojiPickerHint, isSingleEmoji, normalizeEmoji } from "@/personas";
import type { ReactNode } from "react";

/**
 * `navigator.userAgentData` isn't in the standard TS DOM lib yet. Type just
 * the bit we read rather than reaching for `any` or a global augmentation
 * that could clash with other declarations.
 */
type NavigatorUAData = { platform?: string };

/** Reads the platform + touch signals used to phrase the OS-picker hint. */
function detectPlatform(): { platform: string; isTouch: boolean } {
  if (typeof navigator === "undefined") {
    return { platform: "", isTouch: false };
  }
  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData })
    .userAgentData;
  const platform = uaData?.platform ?? navigator.platform ?? "";
  const isTouch =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  return { platform, isTouch };
}

export function EmojiPicker({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (emoji: string) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [customValue, setCustomValue] = useState("");

  const normalizedCustom = normalizeEmoji(customValue);
  const { platform, isTouch } = useMemo(detectPlatform, []);
  const hint = useMemo(
    () => emojiPickerHint({ platform, isTouch }),
    [platform, isTouch],
  );

  function pick(emoji: string) {
    onChange(emoji);
    setOpen(false);
  }

  function useCustom() {
    if (normalizedCustom === null) return;
    onChange(normalizedCustom);
    setOpen(false);
  }

  function handleCustomChange(next: string) {
    setCustomValue(next);
    if (isSingleEmoji(next)) {
      // Inserted straight from the OS picker (or typed one glyph) — apply
      // immediately, no explicit "Use" click needed.
      onChange(next.trim());
      setOpen(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          // Custom field always starts blank — it's for entering something
          // new, not for editing the current value.
          setCustomValue("");
        }
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose an icon</DialogTitle>
          <DialogDescription>
            Pick one, or paste your own.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {EMOJI_GROUPS.map((group) => (
            <div key={group.label} className="flex flex-col gap-1.5">
              <div className="text-xs text-muted-foreground">
                {group.label}
              </div>
              <div className="grid grid-cols-10 gap-1">
                {group.emojis.map((emoji) => {
                  const selected = emoji === value;
                  return (
                    <button
                      key={emoji}
                      type="button"
                      aria-pressed={selected}
                      aria-label={emoji}
                      onClick={() => pick(emoji)}
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-md text-lg hover:bg-state-hover",
                        selected && "bg-state-active ring-1 ring-ring",
                      )}
                    >
                      {emoji}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="emoji-picker-custom" className="text-xs text-muted-foreground">
            Any other emoji
          </label>
          <div className="flex gap-2">
            <Input
              id="emoji-picker-custom"
              value={customValue}
              maxLength={16}
              placeholder="Insert or type an emoji…"
              aria-describedby="emoji-picker-hint"
              onChange={(event) => handleCustomChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  useCustom();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={normalizedCustom === null}
              onClick={useCustom}
            >
              Use
            </Button>
          </div>
          <div id="emoji-picker-hint" className="text-xs text-muted-foreground">
            {hint}
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
