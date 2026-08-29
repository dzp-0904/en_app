import { cn } from "@/lib/utils";

/**
 * The EduTrack lockup: a bold "E" in an indigo rounded square, followed by the
 * wordmark. There is no logo asset in the Figma — the mark is typographic, and
 * is reproduced here the same way rather than being redrawn as artwork.
 *
 * The square is hidden from assistive technology because the wordmark beside it
 * already carries the name; announcing both would read as "E EduTrack".
 *
 * Two sizes, both lifted from the Figma: `md` (36px square, 12px radius) heads
 * the brand panel, `sm` (32px square, 8px radius) is the in-app size.
 */
export function LogoMark({
  size = "md",
  tone = "dark",
  className,
}: {
  size?: "sm" | "md";
  tone?: "light" | "dark";
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div
        aria-hidden="true"
        className={cn(
          "flex shrink-0 items-center justify-center bg-primary font-bold text-primary-foreground",
          size === "md" ? "size-9 rounded-xl text-sm" : "size-8 rounded-lg text-sm",
        )}
      >
        E
      </div>
      <span
        className={cn(
          "font-semibold",
          size === "md" ? "text-lg" : "text-base",
          tone === "light" ? "text-white" : "text-foreground",
        )}
      >
        EduTrack
      </span>
    </div>
  );
}
