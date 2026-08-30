import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The Figma's "nothing here yet" surface, taken from Lesson Logs
 * ("No lesson logs yet" over an "Add first lesson note" button) and repeated on
 * the class roster ("No students in this category").
 *
 * It exists because five screens in this milestone can legitimately have
 * nothing to show, and an empty screen is the one state most likely to be
 * written differently five times. Centred, unelevated, on the same 12px card
 * the stat tiles use — the Figma draws it inside the section it belongs to, not
 * as a page takeover.
 *
 * `title` is a statement of fact, never an apology, and `description` says what
 * would put something here. Neither is optional-sounding filler: a screen with
 * nothing to say passes no `description` rather than inventing one.
 *
 * This is not `Alert`. An alert says something went wrong and the reader should
 * act; an empty state says the query succeeded and the answer was nothing. The
 * two must not look alike, because `null` and `[]` are different facts
 * everywhere else in this codebase and the screen has to keep saying so.
 */
function EmptyState({
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
      data-slot="empty-state"
      className={cn(
        "rounded-xl border border-border bg-card px-6 py-12 text-center",
        className,
      )}
      {...props}
    >
      <p className="text-sm font-medium text-foreground">{title}</p>

      {description ? (
        <p className="mx-auto mt-1.5 max-w-prose text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}

      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export { EmptyState };
