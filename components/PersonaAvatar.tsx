import { cn } from "@/lib/utils";
import { tintFor } from "@/personas";

const SIZES = {
  sm: "size-8 text-base",
  md: "size-10 text-xl",
  lg: "size-12 text-2xl",
} as const;

export function PersonaAvatar({
  personaId,
  emoji,
  size = "md",
  className,
}: {
  personaId: string;
  emoji: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg",
        SIZES[size],
        tintFor(personaId),
        className,
      )}
    >
      {emoji}
    </span>
  );
}
