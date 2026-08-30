import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { PendingTint } from "@/components/ui/pending-tint";

/**
 * The Figma's filter row, from the class roster: `px-3 py-1 text-xs
 * font-medium rounded-full`, the selected pill filled indigo, the rest white
 * behind a hairline that warms to indigo on hover.
 *
 * Presentational and stateless. It renders the options it is handed and marks
 * one selected; which students a filter actually admits is a question about the
 * roster, and it stays with the roster. Like `Tabs`, the options are links so
 * the selection lives in the URL and survives a page load without JavaScript.
 *
 * `flex-wrap` is not in the Figma — the Figma has no small screen at all — but
 * four pills beside a segmented control do not fit 390px on one line, and
 * wrapping is what its own layout would do if it had been asked the question.
 *
 * The unselected label is `--muted-foreground` rather than the Figma's #4A5170
 * on white; those are the same colour, so nothing moves.
 */

export type FilterPillItem = {
  label: string;
  href: string;
  current?: boolean;
};

function FilterPills({
  items,
  label,
  className,
  ...props
}: Omit<React.ComponentProps<"nav">, "children"> & {
  items: FilterPillItem[];
  /** Names the group for assistive technology, e.g. "Filter students". */
  label: string;
}) {
  return (
    <nav data-slot="filter-pills" aria-label={label} {...props}>
      <ul
        className={cn(
          "flex flex-wrap items-center gap-x-1 gap-y-2",
          className,
        )}
      >
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={item.current ? "page" : undefined}
              className={cn(
                "relative block rounded-full px-3 py-1 text-xs font-medium transition-colors outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                item.current
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground",
              )}
            >
              {item.label}
              <PendingTint />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export { FilterPills };
