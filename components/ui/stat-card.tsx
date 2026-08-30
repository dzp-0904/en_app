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
 */
function StatCard({
  label,
  value,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  label: React.ReactNode;
  value: React.ReactNode;
}) {
  return (
    <div
      data-slot="stat-card"
      className={cn(
        "min-w-0 rounded-xl border border-border bg-card p-4",
        className,
      )}
      {...props}
    >
      <p className="truncate text-xl font-semibold text-foreground">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export { StatCard };
