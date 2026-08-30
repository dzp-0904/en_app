import * as React from "react";

import { cn } from "@/lib/utils";
import { Breadcrumb, type Crumb } from "@/components/ui/breadcrumb";

/**
 * The block every signed-in Figma screen opens with: an optional trail, a
 * `text-2xl font-semibold` title, an optional row of metadata under it, and the
 * screen's actions pushed to the right.
 *
 * The title is sans-serif. EduTrack's pages currently set their `h1` in Lora,
 * and the Figma uses Lora exactly twice in thirteen screens — the pull quote on
 * the login panel and the headline on signup — and nowhere else. It is the
 * voice of the marketing panel, not of the application, so page titles here are
 * Public Sans at `text-2xl font-semibold`. Existing pages are not rewritten to
 * use this component; they adopt it as each is rebuilt.
 *
 * The trail sits `mb-1` above the title rather than floating free of it: the
 * Figma groups the two as one block and spaces them by 4px, so the crumb reads
 * as a label on the heading beneath it rather than as its own band.
 *
 * The metadata row is a list of nodes rather than one string, so it can wrap
 * between facts on a narrow screen instead of breaking one of them in half.
 *
 * It is spaced rather than punctuated. The Class Detail screen writes a literal
 * `·` between its facts on top of a `gap-4`, which is belt and braces on a
 * fixed-width mock and neither on a real one: the separator is a text node, so
 * it can wrap onto a line by itself, and a screen reader reads it out. The gap
 * does the same job at every width without adding a character to the page.
 *
 * WRAPPING. The Figma pins the actions to the right of the title on one line
 * and never asks what happens at 390px, where a title and two buttons do not
 * fit. `flex-wrap` answers it without inventing a breakpoint or a second
 * layout: the actions drop below the title when they stop fitting and sit
 * beside it when they do. `min-w-0` on the title block is what allows a long
 * class name to wrap rather than force the row wider than the viewport.
 *
 * The title block is `grow basis-64` and deliberately not `flex-1`, which is
 * `flex: 1 1 0%` — a zero basis means the block never asks for room, so instead
 * of pushing the actions onto their own line it silently crushes itself. Probed
 * at 320px, `flex-1` left the title 30px wide with the metadata spilling out of
 * it. A 16rem basis makes the row wrap before the title gives up any width.
 */
function PageHeader({
  title,
  breadcrumb,
  meta,
  actions,
  className,
  ...props
}: Omit<React.ComponentProps<"header">, "title"> & {
  title: React.ReactNode;
  breadcrumb?: Crumb[];
  meta?: React.ReactNode[];
  actions?: React.ReactNode;
}) {
  return (
    <header data-slot="page-header" className={cn("mb-6", className)} {...props}>
      {breadcrumb?.length ? <Breadcrumb items={breadcrumb} className="mb-1" /> : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 grow basis-64">
          <h1 className="text-2xl font-semibold break-words text-foreground">
            {title}
          </h1>

          {meta?.length ? (
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {meta.map((item, index) => (
                <span key={index} className="min-w-0">
                  {item}
                </span>
              ))}
            </p>
          ) : null}
        </div>

        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}

export { PageHeader };
