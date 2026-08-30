import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The Figma's initials disc. It appears at four sizes — 24 beside the teacher's
 * name on the join card, 28 in the attention list, 32 in the sidebar and the
 * roster, 56 on the profile and settings headers — and the largest is the one
 * exception to the circle: at 56 the Figma switches to a `rounded-2xl` square.
 *
 * Two tones, both the Figma's: `secondary` (indigo on primary-light) for the
 * person being looked at, `primary` (white on indigo) for the person signed in.
 *
 * No images. The Figma's mock data carries an `avatar` field and never renders
 * it, EduTrack stores no such column, and adding one would mean uploads,
 * storage, moderation and a public URL for a photograph of a student — none of
 * which is a styling question.
 *
 * DECORATIVE BY DEFAULT. Every place the Figma draws one, the person's name is
 * written beside it, so the disc is a second rendering of something already
 * said; `aria-hidden` keeps a screen reader from reading "P T" before the name
 * it abbreviates. Pass `label` on the rare occasion it stands alone.
 */

const SIZES = {
  xs: "size-6 text-[10px] rounded-full",
  sm: "size-7 text-xs rounded-full",
  md: "size-8 text-xs rounded-full",
  lg: "size-14 text-lg rounded-2xl",
} as const;

const TONES = {
  secondary: "bg-secondary text-secondary-foreground",
  primary: "bg-primary text-primary-foreground",
} as const;

/**
 * The Figma takes the last two initials rather than the first two, which is the
 * right end of a Vietnamese name: "Nguyễn Thị Linh" is family-first, so the two
 * that identify the person are "T L", not "N T".
 *
 * `Array.from` rather than `[0]` so a name beginning with a character outside
 * the BMP yields a character instead of half of one.
 */
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .slice(-2)
    .toUpperCase();
}

function Avatar({
  name,
  size = "md",
  tone = "secondary",
  label,
  className,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & {
  name: string;
  size?: keyof typeof SIZES;
  tone?: keyof typeof TONES;
  /** Supply only when no adjacent text already names the person. */
  label?: string;
}) {
  const initials = initialsOf(name);

  return (
    <span
      data-slot="avatar"
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-semibold select-none",
        SIZES[size],
        TONES[tone],
        className,
      )}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      {...props}
    >
      {initials}
    </span>
  );
}

export { Avatar, initialsOf };
