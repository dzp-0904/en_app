import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The line that titles a block inside a page, with its action opposite.
 *
 * Every Figma screen with more than one block uses it: "Your Classes" beside
 * "+ New class" on the Dashboard, "Students Needing Attention", "Recent
 * Progress", "Lesson Logs" beside "+ Add Lesson Note". The Figma sets it in
 * `font-semibold text-[#1B2036]` at body size — smaller than the page title,
 * heavier than the prose under it.
 *
 * It renders an `h2`, which is the whole reason it is a component rather than a
 * class string. The pages that used to hand-roll this wrote an uppercase
 * `text-xs` label; that is a different object — a field label — and using it for
 * a section left the document with one heading and several styled paragraphs.
 * An `h1` from `PageHeader` and `h2`s from here is the outline a screen reader
 * actually navigates by.
 *
 * `action` wraps rather than truncates, and the title column carries `min-w-0
 * grow basis-48` for the reason `PageHeader` does: `flex-1` is `flex: 1 1 0%`,
 * whose zero basis makes a block stop asking for room and crush itself.
 */
function SectionHeading({
  title,
  description,
  action,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children" | "title"> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      data-slot="section-heading"
      className={cn(
        "mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2",
        className,
      )}
      {...props}
    >
      <div className="min-w-0 grow basis-48">
        <h2 className="font-semibold break-words text-foreground">{title}</h2>

        {description ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>

      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export { SectionHeading };
