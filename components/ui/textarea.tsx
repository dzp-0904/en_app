import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * `Input`'s styling on a multi-line field.
 *
 * Deliberately the same class list rather than a variant of it: a textarea sits
 * directly beneath text inputs in the same form, and a border or focus ring that
 * disagreed by a pixel would be visible. `field-sizing-content` lets the box grow
 * with what is typed where the browser supports it, and `min-h` keeps it a
 * recognisable multi-line field where it does not.
 *
 * `resize-y` rather than the platform default `resize`: horizontal dragging
 * would let the field escape the column the rest of the form is laid out in.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "block field-sizing-content min-h-24 w-full resize-y rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm text-foreground transition-colors",
        "placeholder:text-placeholder",
        "focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none",
        "[&:user-invalid]:border-destructive [&:user-invalid]:focus:ring-destructive/20",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
