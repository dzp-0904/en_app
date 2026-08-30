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
 * THREE SHAPES, because the Figma draws three and they are not interchangeable.
 *
 *   1. Bare — the class-detail row above the roster. `p-4`, the value in
 *      `text-xl font-semibold`, the label under it.
 *   2. `tone` — the Dashboard's four tiles. `p-5`, an 8px tinted square above
 *      the number holding a 10px dot in the matching hue, and the number a step
 *      larger at `text-2xl`. The colour is per statistic, not per value: it
 *      says which tile you are looking at, not whether the number is good.
 *   3. `layout="label-first"` + `valueTone` — Tuition's three summary cards.
 *      `p-5`, no square at all, the label *above* a `font-bold` number that
 *      carries the colour itself. M22 rendered these as shape 2, which is why
 *      "Tổng học phí" grew a near-black dot the Figma never draws.
 *
 * There is deliberately no `navy` tone. The Figma's tinted marks are only ever
 * `#4466EE`, `#3BA876` and `#E8834A`; `#1B2036` appears in this family exactly
 * once, as the *text* colour of Tuition's Total Expected, and that is shape 3.
 *
 * `valueTone` uses `green-dark`/`orange-dark` rather than the raw hues. At
 * 20px bold the number is large text, and `--green` clears only 2.98:1 on white
 * — the dark pair exists for precisely this and was introduced for the same
 * reason on badges.
 *
 * The mark is `aria-hidden`: the label underneath already names the statistic,
 * and the colour carries nothing a reader would otherwise miss.
 */

const TONES = {
  primary: { tint: "bg-secondary", dot: "bg-primary" },
  green: { tint: "bg-green-light", dot: "bg-green" },
  orange: { tint: "bg-orange-light", dot: "bg-orange" },
} as const;

const VALUE_TONES = {
  foreground: "text-foreground",
  green: "text-green-dark",
  orange: "text-orange-dark",
} as const;

function StatCard({
  label,
  value,
  tone,
  valueTone,
  layout = "value-first",
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  label: React.ReactNode;
  value: React.ReactNode;
  /** The Dashboard's tinted square and dot. Omit for the bare class-detail tile. */
  tone?: keyof typeof TONES;
  /** Colours the number itself — Tuition's collected/outstanding pair. */
  valueTone?: keyof typeof VALUE_TONES;
  /** Tuition puts its label above the number; everything else puts it below. */
  layout?: "value-first" | "label-first";
}) {
  const labelFirst = layout === "label-first";

  const labelNode = (
    <p
      className={cn(
        "text-xs text-muted-foreground",
        labelFirst ? "mb-2" : "mt-0.5",
      )}
    >
      {label}
    </p>
  );

  return (
    <div
      data-slot="stat-card"
      className={cn(
        "min-w-0 rounded-xl border border-border bg-card",
        tone || labelFirst ? "p-5" : "p-4",
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

      {labelFirst ? labelNode : null}

      <p
        className={cn(
          "truncate",
          tone ? "text-2xl" : "text-xl",
          labelFirst ? "font-bold" : "font-semibold",
          VALUE_TONES[valueTone ?? "foreground"],
        )}
      >
        {value}
      </p>

      {labelFirst ? null : labelNode}
    </div>
  );
}

export { StatCard };
