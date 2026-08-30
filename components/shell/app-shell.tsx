import type { ReactNode } from "react";

import { signOut } from "@/app/auth/actions";
import { LogoMark } from "@/components/brand/logo-mark";
import { ClassesMark } from "@/components/icons/classes-mark";
import { NavItem } from "@/components/shell/nav-item";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The frame every signed-in page sits in: a persistent left column carrying the
 * brand, the sections of the product, and who you are signed in as.
 *
 * Rendered by `app/teacher/layout.tsx` and `app/student/layout.tsx`, once each,
 * so the markup exists in one place and the two roles differ only by which row
 * of `NAV` they name. Pages keep their own `<main>` and their own content; the
 * shell adds chrome around them and takes nothing else over.
 *
 * It is not a security boundary and must not become one. A layout renders per
 * navigation *segment* and Next.js reuses it across client-side transitions, so
 * a check placed here would not run for every request — the same reason
 * `app/onboarding/layout.tsx` carries no guard. Every page underneath still
 * calls `loadUserState()`/`requireTeacher()` for itself, and RLS sits under all
 * of it.
 */

export type ShellRole = "teacher" | "student";

/**
 * What each role can navigate to — server-side, keyed by a role the layout read
 * from the database. A student is never handed a teacher's row and cannot ask
 * for one: nothing here is derived from the request.
 *
 * Only routes that exist are listed. The reference direction also names a
 * "Dashboard" pointing at the teacher's landing page, and it is deliberately
 * absent: that landing page is `/teacher`, which is this same "Classes" entry,
 * and EduTrack has no dashboard — `app/teacher/page.tsx` says so in as many
 * words, and reports on nothing. Two labels for one destination would be one
 * button wearing two names, and the second name would be a claim about a
 * feature that does not exist.
 *
 * Lessons, attendance, homework, reports and tuition all get a row here when
 * they get a route. Until then they are not listed at all, disabled or
 * otherwise, because a greyed-out list of six things is still a promise.
 */
const NAV: Record<
  ShellRole,
  {
    heading: string;
    items: { href: string; label: string }[];
  }
> = {
  teacher: {
    heading: "Dành cho giáo viên",
    items: [{ href: "/teacher", label: "Lớp học" }],
  },
  student: {
    heading: "Dành cho học viên",
    items: [{ href: "/student", label: "Lớp học" }],
  },
};

export function AppShell({
  role,
  fullName,
  email,
  children,
}: {
  role: ShellRole;
  fullName: string;
  email: string | null;
  children: ReactNode;
}) {
  const { heading, items } = NAV[role];

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <aside
        className={cn(
          // Narrow: a bar across the top. A drawer would be a lot of machinery
          // to hide a list this short, and the repository has no dialog
          // primitive to build one from. The brand and the sections share the
          // first line; the account block wraps onto the second.
          "flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3 border-b border-border bg-card px-4 py-3",
          // Wide: a column beside the page rather than over it — `sticky` and
          // `self-start` so it stays put as the page scrolls without being
          // lifted out of the flow, which is what would let it overlap.
          "lg:sticky lg:top-0 lg:h-dvh lg:w-60 lg:flex-col lg:flex-nowrap lg:items-stretch lg:gap-0 lg:self-start lg:overflow-y-auto lg:border-r lg:border-b-0 lg:px-5 lg:py-6",
        )}
      >
        <LogoMark size="sm" className="mr-auto lg:mr-0" />

        <nav aria-label="Điều hướng chính" className="lg:mt-9">
          {/* The heading is the sidebar saying which product you are in. On the
              top bar there is no column for it to head, so it is dropped
              rather than squeezed in. */}
          <p className="mb-2 hidden text-xs font-medium tracking-wide text-muted-foreground uppercase lg:block">
            {heading}
          </p>

          <ul className="flex items-center gap-1 lg:flex-col lg:items-stretch">
            {items.map((item) => (
              <li key={item.href}>
                <NavItem href={item.href}>
                  <ClassesMark className="shrink-0" />
                  {item.label}
                </NavItem>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex w-full items-center justify-between gap-3 border-t border-border pt-3 lg:mt-auto lg:block lg:pt-5">
          {/* Name and address, both already loaded to decide the role. Nothing
              else about the account is read for this. */}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {fullName}
            </p>
            {email ? (
              <p className="truncate text-xs text-muted-foreground">{email}</p>
            ) : null}
          </div>

          <form action={signOut} className="shrink-0 lg:mt-2">
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              className="lg:-ml-3"
            >
              Đăng xuất
            </Button>
          </form>
        </div>
      </aside>

      {children}
    </div>
  );
}
