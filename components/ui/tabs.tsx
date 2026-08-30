import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { PendingBar } from "@/components/ui/pending-bar";

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
 *
 * PREFETCH. Links to a server-rendered view cost a round trip, and until the
 * payload lands React holds the page it already has — so a tab click showed
 * nothing at all for the whole wait. Measured on the production build against
 * the hosted Supabase project, the six Class Detail transitions took 635–1068ms
 * from click to any pixel changing, with first paint and final render landing
 * in the same frame: no pending state, no partial view, nothing but a pause.
 *
 * `prefetch` asks Next.js to fetch the sibling views in the background while
 * the current one is being read, so the click is served from the router cache.
 * The same six transitions then measured 5–20ms. It is opt-in rather than
 * always on because it is a trade: every tab in the group is rendered on the
 * server whether or not it is opened, which is worth it for three views of one
 * class a teacher moves between constantly, and would not be for a group whose
 * views are expensive or rarely visited.
 *
 * Nothing about the request changes — same route, same session cookie, same
 * server-side ownership check, same RLS. A prefetch can only return what a
 * click a moment later would have returned.
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
  prefetch = false,
  className,
  ...props
}: Omit<React.ComponentProps<"nav">, "children"> & {
  items: TabItem[];
  variant?: keyof typeof GROUP;
  /** Names the group for assistive technology, e.g. "Class views". */
  label: string;
  /** Fetch the unselected views in the background. See PREFETCH above. */
  prefetch?: boolean;
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
              prefetch={prefetch}
              aria-current={item.current ? "page" : undefined}
              className={cn(
                "relative block px-4 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                ITEM[variant],
                item.current
                  ? ACTIVE[variant]
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
              <PendingBar />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export { Tabs };
