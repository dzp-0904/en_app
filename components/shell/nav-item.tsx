"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * One navigation link, which knows whether the page you are looking at is
 * inside it.
 *
 * The only client component in the shell, and it is client for one reason: a
 * Server Component cannot be told the current path, and highlighting the
 * current section is the whole job. Everything else in the sidebar — who you
 * are, which links you get — is decided on the server and arrives as props.
 *
 * "Inside it" is `href`, or anything below `href/`, which is why `/teacher/new`
 * and `/teacher/<id>` keep "Classes" lit. That is a prefix test on the item's
 * own href rather than a list of paths to match, so a route added under a
 * section is covered the day it is added. The sections themselves are scoped by
 * the route segment: `app/teacher/layout.tsx` renders the teacher navigation
 * and nothing else does, so this comparison never has to tell one role's links
 * apart from another's.
 *
 * `aria-current="page"` rather than colour alone: the tinted background is not
 * information a screen reader can reach.
 */
export function NavItem({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const current = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        current
          ? "bg-secondary text-secondary-foreground"
          : "text-muted-foreground hover:bg-background hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
