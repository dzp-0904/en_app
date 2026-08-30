import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The Figma's segmented control, in its two treatments:
 *
 *   surface  teacher screens — `bg-[#F0EFE9] rounded-lg p-1`, items
 *            `rounded-md`, the selected one white with `shadow-sm`
 *   primary  the student dashboard — a white `rounded-xl` card with a
 *            hairline, items `rounded-lg`, the selected one indigo on white
 *
 * These are LINKS, not scripted tabs. EduTrack holds this kind of state in the
 * URL — the roster panel already opens on `?student=` — which is what lets the
 * pages work with JavaScript switched off, keeps a chosen tab in the back
 * button and in a shared link, and means the server renders the selected view
 * rather than shipping every view and hiding all but one. `current` therefore
 * arrives as a prop: the page already knows which tab it is rendering, and a
 * Server Component cannot read the URL for itself.
 *
 * That is also why this is a `<nav>` of links and not `role="tablist"`. The ARIA
 * tabs pattern promises things links do not do — arrow-key roving focus, and an
 * `aria-controls` panel swapped in the same document — and claiming the role
 * without the behaviour reads worse to a screen reader than the plain
 * navigation this actually is. `aria-current="page"` carries the selection.
 *
 * The Figma sets `capitalize` on the item because its own labels are lowercase
 * enum values. EduTrack's labels come from the `*_LABELS` maps in `lib/`, which
 * are already cased for display, so the class is dropped rather than left to
 * retitle "Needs attention" into "Needs Attention" behind the caller's back.
 *
 * The unselected item is `--muted-foreground`, not the Figma's #8A8FA8: at 14px
 * that grey is 2.9:1 on the group's own ground, below the AA floor. This is the
 * substitution `globals.css` already documents, not a new one.
 */

export type TabItem = {
  label: string;
  href: string;
  current?: boolean;
};

const GROUP = {
  surface: "bg-track rounded-lg",
  primary: "bg-card border border-border rounded-xl",
} as const;

const ITEM = {
  surface: "rounded-md",
  primary: "rounded-lg",
} as const;

const ACTIVE = {
  surface: "bg-card text-foreground shadow-sm",
  primary: "bg-primary text-primary-foreground shadow-sm",
} as const;

function Tabs({
  items,
  variant = "surface",
  label,
  className,
  ...props
}: Omit<React.ComponentProps<"nav">, "children"> & {
  items: TabItem[];
  variant?: keyof typeof GROUP;
  /** Names the group for assistive technology, e.g. "Class views". */
  label: string;
}) {
  return (
    <nav
      data-slot="tabs"
      aria-label={label}
      className={cn("w-fit max-w-full", className)}
      {...props}
    >
      <ul className={cn("flex flex-wrap gap-1 p-1", GROUP[variant])}>
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={item.current ? "page" : undefined}
              className={cn(
                "block px-4 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                ITEM[variant],
                item.current
                  ? ACTIVE[variant]
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export { Tabs };
