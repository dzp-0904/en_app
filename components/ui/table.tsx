import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The Figma's data table, which it uses three times — the class roster, the
 * invitation list and the tuition ledger — always the same way: a white
 * `rounded-xl` card with a hairline and `overflow-hidden`, a cream header row
 * of `text-xs uppercase tracking-wide` labels, hairline separators between
 * rows, no separator under the last one, and a cream wash on hover.
 *
 * NARROW WIDTHS. A table is the one layout that cannot simply reflow: eight
 * columns of roster do not fit 390px, and a `<table>` left to itself will widen
 * its container until the whole document scrolls sideways. So the table sits in
 * its own scroller inside the rounded card. The page never gains a horizontal
 * scrollbar; the table gets one when it needs it, clipped to the card's radius.
 *
 * That scroller is reachable from the keyboard — a region you can only scroll by
 * dragging is unusable without a mouse — and takes `role="region"` with the name
 * the caller supplies, since an unnamed region is worse than none. Callers that
 * pass no label get the tab stop and no role.
 *
 * A scroller is the floor, not the finish: where a table's rows carry enough
 * meaning to be worth restacking, the better answer at 390px is the Figma's own
 * card-list treatment, which it already draws for the students-needing-attention
 * list. That is a per-screen decision and belongs to the milestone that builds
 * the screen.
 *
 * Header cells are `--muted-foreground`, not the Figma's #8A8FA8, which at 12px
 * uppercase is 2.72:1 on cream — the substitution `globals.css` documents.
 */
function Table({
  className,
  containerClassName,
  label,
  ...props
}: React.ComponentProps<"table"> & {
  containerClassName?: string;
  /** Names the scrollable region, e.g. "Students". */
  label?: string;
}) {
  return (
    <div
      data-slot="table-container"
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card",
        containerClassName,
      )}
    >
      <div
        data-slot="table-scroller"
        tabIndex={0}
        {...(label ? { role: "region", "aria-label": label } : {})}
        className="overflow-x-auto outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <table
          data-slot="table"
          className={cn("w-full border-collapse text-left", className)}
          {...props}
        />
      </div>
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        "border-b border-border bg-background [&_tr]:border-0",
        className,
      )}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-border transition-colors hover:bg-background",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      scope="col"
      data-slot="table-head"
      className={cn(
        "px-4 py-3 text-xs font-medium tracking-wide text-muted-foreground uppercase",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn("px-4 py-4 text-sm text-foreground", className)}
      {...props}
    />
  );
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
