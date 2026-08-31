import type { ReactNode } from "react";

import { signOut } from "@/app/auth/actions";
import { LogoMark } from "@/components/brand/logo-mark";
import { ClassesMark } from "@/components/icons/classes-mark";
import {
  CalendarMark,
  DashboardMark,
  LessonLogsMark,
  ReportsMark,
  SettingsMark,
  TuitionMark,
} from "@/components/icons/nav-marks";
import { Nav, type NavEntry } from "@/components/shell/nav";
import { StudentShell } from "@/components/shell/student-shell";
import { Avatar } from "@/components/ui/avatar";
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
 * The teacher's seven sections are the Figma's `Layout.tsx` navigation, in its
 * order. This list previously held one row, with a comment explaining that
 * lessons, reports and tuition would each get a row "when they get a route" —
 * because a greyed-out list of six things is still a promise. They have routes
 * now, and every one of them reads a table that has existed since the schema
 * was created: `class_sessions` behind the calendar, `lesson_logs` behind the
 * lesson log, `monthly_reports` behind reports, `tuition_records` behind
 * tuition, `profiles` behind settings. Nothing here links to a placeholder.
 *
 * "Tổng quan" and "Lớp học" are two destinations, not one label twice. The
 * landing page is now the Figma's Dashboard — a greeting, four counts it can
 * actually derive, and the classes list — and the full class list has moved to
 * `/teacher/classes`, which is where the sidebar's second row goes. That is
 * also why `fallback` exists: `/teacher/new` and `/teacher/<class id>` belong
 * with "Lớp học" rather than with the dashboard they sit under.
 *
 * There is no student row here any more. The Figma has exactly one student
 * screen and does not put it in this shell at all — it draws a top bar over a
 * centred column — which M22 recorded as a known deviation and M26 corrects:
 * `role="student"` now renders `components/shell/student-shell.tsx` instead.
 * This table is the teacher's navigation and nothing else.
 */
const NAV: Record<
  "teacher",
  {
    heading: string;
    root: string;
    fallback?: string;
    items: NavEntry[];
  }
> = {
  teacher: {
    heading: "Dành cho giáo viên",
    root: "/teacher",
    fallback: "/teacher/classes",
    items: [
      { href: "/teacher", label: "Tổng quan", icon: <DashboardMark /> },
      { href: "/teacher/classes", label: "Lớp học", icon: <ClassesMark /> },
      { href: "/teacher/calendar", label: "Lịch dạy", icon: <CalendarMark /> },
      {
        href: "/teacher/lesson-logs",
        label: "Nhật ký buổi học",
        icon: <LessonLogsMark />,
      },
      { href: "/teacher/reports", label: "Báo cáo", icon: <ReportsMark /> },
      { href: "/teacher/tuition", label: "Học phí", icon: <TuitionMark /> },
      { href: "/teacher/settings", label: "Cài đặt", icon: <SettingsMark /> },
    ],
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
  // Two different chromes, because the design has two. See the note above
  // `NAV` and the one on `StudentShell` itself.
  if (role === "student") {
    return (
      <StudentShell fullName={fullName} email={email}>
        {children}
      </StudentShell>
    );
  }

  const { heading, root, fallback, items } = NAV.teacher;

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <aside
        className={cn(
          // Narrow: a bar across the top. A drawer would be a lot of machinery
          // to hide a list this short, and the repository has no dialog
          // primitive to build one from. The brand and the sections share the
          // first line; the account block wraps onto the second. Seven rows
          // wrap onto as many lines as they need rather than scrolling
          // sideways — `flex-wrap` on the list is what keeps the page itself
          // from ever gaining a horizontal scrollbar at 320px.
          "flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3 border-b border-border bg-card px-4 py-3",
          // Wide: a column beside the page rather than over it — `sticky` and
          // `self-start` so it stays put as the page scrolls without being
          // lifted out of the flow, which is what would let it overlap.
          "lg:sticky lg:top-0 lg:h-dvh lg:w-60 lg:flex-col lg:flex-nowrap lg:items-stretch lg:gap-0 lg:self-start lg:overflow-y-auto lg:border-r lg:border-b-0 lg:px-5 lg:py-6",
        )}
      >
        {/* The Figma closes its logo block with a rule before the navigation
            starts. Wide only: on a narrow screen the brand and the sections
            share one line, so a divider between them would cut the bar in
            half. */}
        <LogoMark
          size="sm"
          subtitle={heading}
          className="mr-auto lg:mr-0 lg:w-full lg:border-b lg:border-border lg:pb-5"
        />

        <Nav
          entries={items}
          root={root}
          fallback={fallback}
          label="Điều hướng chính"
          className="lg:mt-5 lg:w-full"
        />

        <div className="flex w-full items-center justify-between gap-3 border-t border-border pt-3 lg:mt-auto lg:block lg:pt-5">
          {/* Name and address, both already loaded to decide the role. Nothing
              else about the account is read for this. The disc is the Figma's
              32px initials avatar and is drawn from the name that is already
              printed beside it, so it is `aria-hidden` and adds no new read. */}
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar name={fullName} size="md" tone="primary" />

            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {fullName}
              </p>
              {email ? (
                <p className="truncate text-xs text-muted-foreground">{email}</p>
              ) : null}
            </div>
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
