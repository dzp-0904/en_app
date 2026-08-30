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
 *
 * `subtitle` is the Figma's "for Teachers" line, set directly under the
 * wordmark at 10px with no leading. The shell used to render that text as an
 * uppercase heading above the navigation list instead, which is neither where
 * nor what the design puts it.
 */
export function LogoMark({
  size = "md",
  tone = "dark",
  subtitle,
  className,
}: {
  size?: "sm" | "md";
  tone?: "light" | "dark";
  subtitle?: string;
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
      <div className="min-w-0">
        <span
          className={cn(
            "block font-semibold",
            size === "md" ? "text-lg" : "text-base",
            tone === "light" ? "text-white" : "text-foreground",
          )}
        >
          EduTrack
        </span>
        {subtitle ? (
          <p
            className={cn(
              "text-[10px] leading-none",
              tone === "light" ? "text-white/70" : "text-muted-foreground",
            )}
          >
            {subtitle}
          </p>
        ) : null}
      </div>
    </div>
  );
}
