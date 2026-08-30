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
 * CONTRAST. Two tones already resolve to the repository's accessible values —
 * `neutral` carries `--muted-foreground` rather than the Figma's #8A8FA8, and
 * `destructive` carries #B42318 rather than #EF4444 — and both clear AA (7.18:1
 * and 6.03:1). The other three are the Figma's own pairs and do not: green
 * measures 2.78:1, orange 2.47:1 and primary 4.22:1 against their tints, all
 * short of the 4.5:1 that 12px text needs. Darkening those three foregrounds is
 * the same repair the palette already applies twice over, but it is a change to
 * a colour the design specifies, so it is written up for a decision rather than
 * made here. Nothing renders a Badge yet, so nothing inaccessible ships ahead
 * of that decision.
 */
const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      tone: {
        neutral: "bg-background text-muted-foreground",
        primary: "bg-secondary text-secondary-foreground",
        green: "bg-green-light text-green",
        orange: "bg-orange-light text-orange",
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
