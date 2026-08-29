import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A native `<select>` wearing `Input`'s clothes.
 *
 * The Figma draws a plain dropdown, so this stays a real `<select>` rather than a
 * listbox built from divs: it is keyboard-navigable, announces itself correctly,
 * opens as the platform picker on mobile, and — the reason it matters here — it
 * submits inside a `<form>` with no JavaScript, which is what lets the class step
 * work as a progressively-enhanced Server Action.
 *
 * `appearance-none` removes the platform arrow, so the chevron is drawn back as
 * an overlaid SVG. It was first written as a `bg-[url(data:…)]` arbitrary value;
 * that silently produced nothing, because the spaces inside the inline SVG make
 * Tailwind read the value as several class names and the rule is never emitted.
 * The result compiles to no arrow at all, which is only visible by inspecting the
 * built CSS — hence the element.
 *
 * `pointer-events-none` on the wrapper's chevron keeps the whole control
 * clickable: without it, clicking the arrow would hit the span instead of the
 * select.
 */
function Select({
  className,
  children,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="select"
        className={cn(
          "block w-full appearance-none rounded-lg border border-input bg-card py-2.5 pr-10 pl-3.5 text-sm text-foreground transition-colors",
          "focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none",
          "[&:user-invalid]:border-destructive [&:user-invalid]:focus:ring-destructive/20",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
        {...props}
      >
        {children}
      </select>

      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-decorative"
      >
        <path d="M4 6l4 4 4-4" />
      </svg>
    </div>
  );
}

export { Select };
