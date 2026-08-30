import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The Figma's summary tile, from the row above the class roster: `bg-white
 * rounded-xl border p-4`, the number in `text-xl font-semibold`, its label
 * underneath in `text-xs`.
 *
 * A label and a value, and nothing else. It does not count, average, or decide
 * what is worth counting — the audit found the teacher landing page carrying a
 * comment to the effect that a number on the page would have to come from
 * somewhere, and that is still the rule. A screen that has a real figure to
 * show passes it in; a screen that would have to invent one does not get a row
 * of tiles.
 *
 * `value` is a node rather than a string so a band can arrive as "6.5" beside a
 * unit, or a count as a plain number, without this deciding how to format it.
 *
 * Card, not `Card`: `components/ui/card.tsx` is the Figma's 16px `rounded-2xl`
 * surface with `p-6` and a shadow, which is a different object — the stat tile
 * is 12px, unelevated, and tighter.
 *
 * `tone` is the Dashboard's variant of the same tile. Its four tiles are `p-5`
 * and carry an 8px tinted square above the number, holding a 10px dot in the
 * matching hue — a colour per statistic, not per value, so it says which tile
 * you are looking at rather than whether the number is good. It is optional
 * because the class-detail row above the roster has no such square, and both
 * are the Figma. The mark is `aria-hidden`: the label underneath already names
 * the statistic, and the colour carries nothing a reader would otherwise miss.
 */

const TONES = {
  primary: { tint: "bg-secondary", dot: "bg-primary" },
  green: { tint: "bg-green-light", dot: "bg-green" },
  orange: { tint: "bg-orange-light", dot: "bg-orange" },
  navy: { tint: "bg-muted", dot: "bg-navy" },
} as const;

function StatCard({
  label,
  value,
  tone,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: keyof typeof TONES;
}) {
  return (
    <div
      data-slot="stat-card"
      className={cn(
        "min-w-0 rounded-xl border border-border bg-card",
        tone ? "p-5" : "p-4",
        className,
      )}
      {...props}
    >
      {tone ? (
        <span
          aria-hidden
          className={cn(
            "mb-3 flex size-8 items-center justify-center rounded-lg",
            TONES[tone].tint,
          )}
        >
          <span className={cn("size-2.5 rounded-full", TONES[tone].dot)} />
        </span>
      ) : null}

      <p className="truncate text-xl font-semibold text-foreground">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export { StatCard };
