import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LogoMark } from "@/components/brand/logo-mark";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { isOnboardingComplete, loadUserState } from "@/lib/onboarding";
import { loadTeacherClasses } from "@/lib/teacher";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Lớp học của bạn",
};

/**
 * The teacher's home — the first page in the product that exists after
 * onboarding rather than during it.
 *
 * Until now `/` was the end of the teacher's road: it said the class was ready
 * and linked back into the wizard, which meant the only way to look at a class
 * was to re-enter setup. This is the list that was missing, and it is
 * deliberately the same shape as `/student`: who you are, what you have, a way
 * into each one, a way out.
 *
 * It is not a dashboard and reports on nothing. Sessions, attendance, scores,
 * homework and tuition all have tables and policies already, and none of them
 * is read here — a number on this page would have to come from somewhere.
 *
 * The brand, the account and the way out have moved into the application shell
 * that `app/teacher/layout.tsx` wraps this in, so they are not repeated below.
 */
export default async function TeacherPage() {
  const state = await loadUserState();

  if (state.kind === "anonymous") {
    redirect("/auth/login");
  }

  // Students and unplaceable accounts are both `/`'s problem, not this page's.
  if (state.kind !== "teacher") {
    redirect("/");
  }

  const { userId, fullName } = state.teacher;

  // The same condition the layout uses to decide whether to draw the shell. A
  // teacher who has not finished setting up is not given it, and this page is
  // the only one under `/teacher` they can reach — so it carries the brand
  // itself rather than rendering with nothing at the top of it.
  const framed = isOnboardingComplete(state.teacher);

  const supabase = await createClient();
  const classes = await loadTeacherClasses(supabase, userId);

  return (
    // Start-aligned at the Figma's own width for the class list — its teacher
    // screens hang from the sidebar's edge rather than centring in the viewport.
    // Without the shell there is no edge to hang from, so the un-onboarded case
    // keeps the wizard's centred column and its own brand mark.
    <PageShell
      width={framed ? "3xl" : "lg"}
      align={framed ? "start" : "center"}
    >
      {framed ? null : <LogoMark className="mb-12" />}

      <PageHeader
        title={`Chào mừng trở lại, ${fullName}`}
        actions={
          /* Only alongside a list. With no classes the empty state below makes
             the same offer in the teacher's own words, and repeating it here
             would give one action two buttons. */
          classes && classes.length > 0 ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/teacher/new">Tạo lớp học</Link>
            </Button>
          ) : null
        }
      />

      <h2 className="mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Lớp học của bạn
      </h2>

      {classes === null ? (
        // Distinct from "no classes" on purpose: the query failed, and a
        // teacher told they have none would reasonably go and make another.
        <Alert>
          Chúng tôi chưa tải được danh sách lớp học của bạn. Vui lòng tải lại
          trang.
        </Alert>
      ) : classes.length === 0 ? (
        <Card>
          <p className="mb-5 text-sm text-muted-foreground">
            Bạn chưa tạo lớp học nào.
          </p>
          <Button asChild>
            <Link href="/onboarding/class">Tạo lớp học đầu tiên</Link>
          </Button>
        </Card>
      ) : (
        <ul className="space-y-3">
          {classes.map((entry) => (
            <li key={entry.classId}>
              <Card>
                {/* The Figma's class card leads with the name, prints the
                    schedule under it, and puts the target band opposite —
                    all three already came back with the roster counts and
                    were being thrown away. `schedule_note` is display-only
                    by the migration's own comment, so it is printed as the
                    teacher typed it and nothing is derived from it. */}
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0 grow basis-48">
                    <h3 className="font-semibold break-words text-foreground">
                      {entry.className}
                    </h3>

                    {entry.scheduleNote ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {entry.scheduleNote}
                      </p>
                    ) : null}
                  </div>

                  {entry.targetBand === null ? null : (
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-muted-foreground">
                        Band mục tiêu
                      </p>
                      <Badge tone="primary" className="mt-1">
                        {`IELTS ${entry.targetBand.toFixed(1)}`}
                      </Badge>
                    </div>
                  )}
                </div>

                <p className="mt-3 text-sm text-muted-foreground">
                  {`${entry.studentCount} học viên`}
                  {entry.pendingCount > 0
                    ? ` · ${entry.pendingCount} đang chờ`
                    : null}
                </p>

                <Button asChild variant="outline" size="sm" className="mt-4">
                  <Link href={`/teacher/${entry.classId}`}>Mở lớp</Link>
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
