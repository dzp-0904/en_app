import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The Figma's bar: a `rounded-full` track in #F0EFE9 with a `rounded-full` fill
 * laid over it, used at four heights — 1.5 in a table cell and a skill card, 2
 * on the band journey, 2.5 in the student hero, 3 on the report.
 *
 * It displays a number and computes nothing. The Figma's own bars are driven by
 * expressions like `(current - start) / (target - start)`, and every one of
 * those is a statement about a student's standing: which entry counts as the
 * starting band, whether a member with no scores has a current band at all,
 * what happens when the target is below the start. Those answers live in the
 * database views and in `lib/score.ts`, and they must keep living there — a bar
 * that did its own arithmetic would be a second, quieter source of truth for a
 * number the teacher acts on. So `value` and `max` arrive already decided.
 *
 * What it will not do is misdraw them: the fill is clamped to 0–100% so a value
 * past `max` cannot overhang the track, a non-finite or non-positive `max`
 * yields an empty bar rather than a division by zero, and `overflow-hidden`
 * keeps the fill inside the track's radius.
 *
 * `min-w-0` is on the track itself, not left to the caller. Every Figma bar
 * sits in a flex row beside a label and a value, and a flex item defaults to
 * `min-width: auto`, which would let a long neighbour push the bar out of its
 * row instead of letting the bar shrink.
 *
 * ACCESSIBILITY. The Figma always prints the number next to the bar, which
 * makes the bar itself decorative — a second announcement of "6.5" would be
 * noise. So it is `aria-hidden` unless given a `label`, and passing one turns it
 * into a real `progressbar` with its value exposed. Callers should pass a label
 * only when the bar is the sole carrier of the number.
 */

const HEIGHTS = {
  sm: "h-1.5",
  md: "h-2",
  lg: "h-2.5",
  xl: "h-3",
} as const;

const TONES = {
  primary: "bg-primary",
  green: "bg-green",
  orange: "bg-orange",
  navy: "bg-navy",
} as const;

function percentOf(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

function ProgressBar({
  value,
  max,
  size = "sm",
  tone = "primary",
  label,
  className,
  trackClassName,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  value: number;
  max: number;
  size?: keyof typeof HEIGHTS;
  tone?: keyof typeof TONES;
  /** Supply only when no adjacent text already states the value. */
  label?: string;
  /** Applied to the track; `className` styles the fill. */
  trackClassName?: string;
}) {
  const percent = percentOf(value, max);
  const described = label !== undefined;

  return (
    <div
      data-slot="progress-bar"
      className={cn(
        "w-full min-w-0 overflow-hidden rounded-full bg-track",
        HEIGHTS[size],
        trackClassName,
      )}
      {...(described
        ? {
            role: "progressbar",
            "aria-label": label,
            "aria-valuenow": value,
            "aria-valuemin": 0,
            "aria-valuemax": max,
          }
        : { "aria-hidden": true })}
      {...props}
    >
      <div
        data-slot="progress-bar-fill"
        className={cn("h-full rounded-full", TONES[tone], className)}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export { ProgressBar };
