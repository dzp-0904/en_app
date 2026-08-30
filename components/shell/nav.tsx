"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { PendingTint } from "@/components/ui/pending-tint";

/**
 * The sidebar's list of sections, which knows which one you are looking at.
 *
 * The only client component in the shell, and it is client for one reason: a
 * Server Component cannot be told the current path, and highlighting the
 * current section is the whole job. Everything else — who you are, which
 * sections you get — is decided on the server and arrives as props.
 *
 * WHY THE WHOLE LIST AND NOT ONE ITEM AT A TIME. This replaced a per-item
 * component that lit itself on `pathname === href || pathname.startsWith(href +
 * "/")`. That rule was correct while the teacher had exactly one section; with
 * seven it lights several at once, because `/teacher` is a prefix of
 * `/teacher/calendar`. Deciding "which section" is a question about the list,
 * so the list is what answers it:
 *
 *   the longest `href` that the path is at or below wins.
 *
 * `/teacher/calendar` is matched by both `/teacher` and `/teacher/calendar`,
 * and the longer one takes it. `/teacher` exactly is matched only by `/teacher`.
 *
 * `fallback` covers the rest. `/teacher/new` and `/teacher/<class id>` sit
 * under the dashboard's href without being the dashboard, and the class id is a
 * uuid so it cannot be enumerated here. Anything strictly below the section
 * root that no item claims is a class, and belongs to whichever item names
 * itself the fallback — the same collapse the Figma's `Layout.tsx` performs
 * when it maps class-detail, student-profile, create-class and invite-students
 * onto "Classes".
 *
 * `aria-current="page"` rather than colour alone: the tinted background is not
 * information a screen reader can reach. Exactly one item ever carries it,
 * which is what the longest-match rule guarantees and what the accessibility
 * pass checks for.
 */

export type NavEntry = {
  href: string;
  label: string;
  icon: ReactNode;
};

/** Whether `pathname` is `href` or sits below it. */
function covers(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Nav({
  entries,
  root,
  fallback,
  label,
  className,
}: {
  entries: NavEntry[];
  /** The role's own segment, e.g. "/teacher". Paths below it are in scope. */
  root: string;
  /** Where an unclaimed path below `root` belongs. Omit for a flat section. */
  fallback?: string;
  /** Names the landmark, e.g. "Điều hướng chính". */
  label: string;
  className?: string;
}) {
  const pathname = usePathname();

  let currentHref: string | null = null;
  let matched = -1;

  for (const entry of entries) {
    if (covers(pathname, entry.href) && entry.href.length > matched) {
      currentHref = entry.href;
      matched = entry.href.length;
    }
  }

  // Below the root but claimed by nothing: a class page. `matched` is the
  // root's own length in that case, because `root` is the only href that
  // covered it — so anything deeper than the root and no more specific than it
  // is what the fallback exists for.
  if (fallback && pathname !== root && covers(pathname, root) && matched <= root.length) {
    currentHref = fallback;
  }

  return (
    <nav aria-label={label} className={className}>
      <ul className="flex flex-wrap items-center gap-1 lg:flex-col lg:flex-nowrap lg:items-stretch">
        {entries.map((entry) => {
          const current = entry.href === currentHref;

          return (
            <li key={entry.href}>
              <Link
                href={entry.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  current
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-background hover:text-foreground",
                )}
              >
                <span className="w-4 shrink-0 text-center opacity-70">
                  {entry.icon}
                </span>
                {entry.label}
                <PendingTint />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
