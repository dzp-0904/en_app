import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { LABELS } from "@/lib/course-type";
import { loadUserState } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import { loadTeacherClasses } from "@/lib/teacher";

export const metadata: Metadata = {
  title: "Lớp học",
};

/**
 * Every class the teacher has, in full.
 *
 * The list that used to be `/teacher`. It moved when that page became the
 * Figma's Dashboard, which shows only the first few classes and links here for
 * the rest — the same split the Figma's own sidebar draws by naming "Dashboard"
 * and "Classes" as two destinations.
 *
 * `/teacher/classes` sits beside `/teacher/[classId]` in the routing table, and
 * a static segment wins over a dynamic one in Next.js, so this page is reached
 * and no class is shadowed: `classId` is a uuid and "classes" is not one, which
 * `isUuid` already refuses on the detail page.
 *
 * Everything here was already loaded by `loadTeacherClasses` and previously
 * discarded — the course type, the dates, the schedule note. This is the
 * screen with room for them.
 */

const DATE = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  // `start_date` and `end_date` are `date` columns — calendar squares, not
  // instants — so they are read at UTC midnight and formatted there. See
  // `lib/time.ts` for the instants, which are a different problem.
  timeZone: "UTC",
});

function formatDate(isoDate: string): string {
  return DATE.format(new Date(`${isoDate}T00:00:00Z`));
}

export default async function TeacherClassesPage() {
  const state = await loadUserState();

  if (state.kind === "anonymous") {
    redirect("/auth/login");
  }

  if (state.kind !== "teacher") {
    redirect("/");
  }

  const supabase = await createClient();
  const classes = await loadTeacherClasses(supabase, state.teacher.userId);

  return (
    <PageShell width="3xl" align="start">
      <PageHeader
        title="Lớp học"
        breadcrumb={[
          { label: "Tổng quan", href: "/teacher" },
          { label: "Lớp học" },
        ]}
        meta={
          classes && classes.length > 0
            ? [`${classes.length} lớp học đang hoạt động`]
            : undefined
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/teacher/new">Tạo lớp học</Link>
          </Button>
        }
      />

      {classes === null ? (
        <Alert>
          Chúng tôi chưa tải được danh sách lớp học của bạn. Vui lòng tải lại
          trang.
        </Alert>
      ) : classes.length === 0 ? (
        <EmptyState
          title="Bạn chưa tạo lớp học nào"
          description="Tạo lớp học đầu tiên để bắt đầu theo dõi tiến bộ của học viên."
          action={
            <Button asChild>
              <Link href="/teacher/new">Tạo lớp học</Link>
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {classes.map((entry) => (
            <li key={entry.classId}>
              <Card variant="list">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0 grow basis-48">
                    <h2 className="font-semibold break-words text-foreground">
                      {entry.className}
                    </h2>

                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {entry.courseType === "other"
                        ? (entry.courseTypeOther ?? "Khác")
                        : LABELS[entry.courseType]}
                    </p>
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

                {/* `schedule_note` is display-only by the migration's own
                    comment, so it is printed as the teacher typed it and
                    nothing is derived from it. The dates beside it are the
                    columns that mean something. */}
                <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {entry.scheduleNote ? (
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">Lịch học</dt>
                      <dd className="mt-0.5 text-sm break-words text-foreground">
                        {entry.scheduleNote}
                      </dd>
                    </div>
                  ) : null}

                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">Thời gian</dt>
                    <dd className="mt-0.5 text-sm text-foreground">
                      {entry.endDate
                        ? `${formatDate(entry.startDate)} – ${formatDate(entry.endDate)}`
                        : `Từ ${formatDate(entry.startDate)}`}
                    </dd>
                  </div>
                </dl>

                <p className="mt-4 text-sm text-muted-foreground">
                  {`${entry.studentCount} học viên`}
                  {entry.pendingCount > 0
                    ? ` · ${entry.pendingCount} đang chờ`
                    : null}
                </p>

                {/* A plain link, not a clickable card: the whole surface being
                    a target would swallow anything added to it later, and a
                    link is what a keyboard and a screen reader can find. */}
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
