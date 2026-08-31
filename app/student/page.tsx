import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { loadUserState } from "@/lib/onboarding";

export const metadata: Metadata = {
  title: "Lớp học của bạn",
};

/**
 * The student's home: which classes they are in, and a way into each one.
 *
 * THE FIGMA HAS NO SCREEN FOR THIS, and that is not an oversight to be filled
 * in by invention. Its student is hard-coded into a single class, so its one
 * student screen is a dashboard *of* that class — which is `/student/[classId]`
 * here. A real student can hold several memberships, so something has to choose
 * between them, and this is it. The same relationship `/teacher/classes` has
 * with the Figma's Dashboard, and the same answer decision **T** already gave:
 * a screen with no design is built from the design's own vocabulary — the list
 * card, the page header, the 4xl column — and is not "restored" to a mock that
 * does not exist.
 *
 * It stays a list. Everything about a class beyond its name lives one link
 * away, on the screen the Figma actually drew.
 *
 * Access control is `loadUserState` and, underneath it, RLS. A teacher who
 * types this URL is sent to `/`, which is where teachers are sorted; the query
 * behind `state.student.classes` is pinned to `auth.uid()` by
 * `class_members_student_select` regardless of what any page asks for.
 *
 * The brand, the account and the way out live in the application shell that
 * `app/student/layout.tsx` wraps this in, so they are not repeated below.
 */

const JOINED = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

export default async function StudentPage() {
  const state = await loadUserState();

  if (state.kind === "anonymous") {
    redirect("/auth/login");
  }

  // Teachers and unplaceable accounts are both `/`'s problem, not this page's.
  if (state.kind !== "student") {
    redirect("/");
  }

  const { classes } = state.student;

  return (
    <PageShell width="4xl" align="center">
      {/* The greeting belongs to the class screen, where the Figma puts it and
          where there is something to greet the student about. Here the name is
          already in the bar overhead, so the title says what the page is. */}
      <PageHeader
        title="Lớp học của bạn"
        meta={
          classes && classes.length > 0
            ? [`${classes.length} lớp học`]
            : undefined
        }
      />

      {classes === null ? (
        // Distinct from "no classes" on purpose: the query failed, and
        // telling someone who has joined a class that they have not is the
        // exact bug this page was written to fix.
        <Alert>
          Chúng tôi chưa tải được lớp học của bạn. Vui lòng tải lại trang.
        </Alert>
      ) : classes.length === 0 ? (
        <EmptyState
          title="Bạn chưa tham gia lớp học nào"
          description="Khi giáo viên gửi liên kết mời, hãy mở liên kết đó để tham gia."
        />
      ) : (
        <ul className="space-y-3">
          {classes.map((entry) => (
            <li key={entry.membershipId}>
              <Card variant="list">
                <h3 className="mb-1 font-semibold text-foreground">
                  {entry.className}
                </h3>

                {entry.teacherName ? (
                  <p className="text-sm text-muted-foreground">
                    Giáo viên: {entry.teacherName}
                  </p>
                ) : null}

                {entry.joinedAt ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Tham gia {JOINED.format(new Date(entry.joinedAt))}
                  </p>
                ) : null}

                {/* A plain link, not a clickable card: the whole surface
                    being a target would swallow anything added to it later,
                    and a link is what a keyboard and a screen reader can
                    actually find. */}
                <Button asChild variant="outline" size="sm" className="mt-4">
                  <Link href={`/student/${entry.classId}`}>Mở lớp học</Link>
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
