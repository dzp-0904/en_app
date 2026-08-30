import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * The Figma's pill: `inline-flex px-2.5 py-0.5 rounded-full text-xs
 * font-medium`, filled with one of its tinted colour pairs.
 *
 * The variants are named after the tints rather than after any domain value.
 * The Figma reuses the same five pairs across student standing, lesson-note
 * performance, invitation state and tuition state, so a badge that knew what
 * "improving" meant would have to know all four vocabularies — and the mapping
 * would then live here instead of beside the enum it belongs to. The caller
 * picks the tone; `lib/` keeps the meaning.
 *
 * For reference, the mappings the Figma draws:
 *
 *   standing     improving green · stable neutral · needs attention orange
 *   performance  Excellent green · Good primary · Developing orange ·
 *                Needs Attention destructive
 *   invitation   joined green · invitation sent primary · pending neutral
 *
 * Attendance has no Figma counterpart — the Figma records it as a boolean — so
 * EduTrack's four statuses map onto the same tones by the same logic: present
 * green, late orange, absent destructive, excused neutral.
 *
 * The tint is never the only carrier of meaning. A badge renders its label as
 * text and there is no icon-only mode, so the state survives greyscale, a
 * screen reader, and a colour-blind reader alike.
 *
 * CONTRAST. Four of the five tones clear AA at 12px. `neutral` and
 * `destructive` always did, because they already resolve to the repository's
 * accessible substitutions rather than the Figma's own #8A8FA8 and #EF4444
 * (6.62:1 and 6.03:1).
 *
 * `green` and `orange` did not. The Figma writes each badge in the same hue as
 * its tint, which measures 2.78:1 and 2.47:1, so both now carry `--green-dark`
 * and `--orange-dark`: foregrounds darkened just far enough to reach 4.67:1 and
 * 4.93:1 while still reading as the Figma's green and orange. That is the
 * repair `--destructive` already is, applied twice more.
 *
 * `neutral`'s tint moved too, though for a different reason. The Figma fills it
 * with #F7F6F1, which is also what `TableRow` paints a hovered or selected row,
 * so on the roster a `Steady` badge dissolved into the row under the pointer
 * while its neighbours stayed pills. It sits on `--muted` instead — one step
 * darker, still the same family, and it costs 0.56 of a contrast ratio it has
 * to spare.
 *
 * `primary` is the exception and is left as the Figma sets it, at 4.22:1.
 * Nothing renders it: the three tones the roster's status vocabulary needs are
 * green, neutral and orange. The same pair already ships in `nav-item.tsx`'s
 * active state, so changing it here would either fix half of a problem or drag
 * the sidebar into a milestone about one page. It is still open.
 */
const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      tone: {
        neutral: "bg-muted text-muted-foreground",
        primary: "bg-secondary text-secondary-foreground",
        green: "bg-green-light text-green-dark",
        orange: "bg-orange-light text-orange-dark",
        destructive: "bg-destructive-light text-destructive",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ tone, className }))}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
