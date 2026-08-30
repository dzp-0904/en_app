import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The Figma's trail: `text-sm`, muted ancestors that warm to indigo on hover, a
 * "/" between them, and the current page in navy `font-medium`. It appears at
 * two levels on the invite screen and three on the student profile, so depth is
 * whatever the caller passes.
 *
 * The last item is the current page and is rendered as text, not a link —
 * `aria-current="page"` on a link to the page you are already on is a dead end
 * for anyone tabbing through. Any item may also omit `href` to sit in the trail
 * unlinked, which is what a section with no page of its own needs.
 *
 * The separators are `aria-hidden`: the `<nav aria-label="Đường dẫn">` and the
 * ordered list already convey the structure, and a screen reader announcing
 * "slash" between every crumb is noise.
 *
 * It only draws the trail. It does not read the route, derive labels from path
 * segments, or know which pages exist — the page that renders it knows what it
 * is and what it sits under, and that is the only place that knows it reliably.
 */

export type Crumb = {
  label: string;
  href?: string;
};

function Breadcrumb({
  items,
  className,
  ...props
}: Omit<React.ComponentProps<"nav">, "children"> & { items: Crumb[] }) {
  return (
    <nav
      data-slot="breadcrumb"
      aria-label="Đường dẫn"
      className={cn("text-sm", className)}
      {...props}
    >
      <ol className="flex flex-wrap items-center gap-2">
        {items.map((item, index) => {
          const last = index === items.length - 1;

          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-2">
              {index > 0 ? (
                <span aria-hidden className="text-decorative">
                  /
                </span>
              ) : null}

              {last ? (
                <span aria-current="page" className="font-medium text-foreground">
                  {item.label}
                </span>
              ) : item.href ? (
                <Link
                  href={item.href}
                  className="rounded-sm text-muted-foreground transition-colors outline-none hover:text-primary focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {item.label}
                </Link>
              ) : (
                <span className="text-muted-foreground">{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export { Breadcrumb };
