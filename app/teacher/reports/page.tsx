import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ReportPreview } from "@/components/report/report-preview";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterPills, type FilterPillItem } from "@/components/ui/filter-pills";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { PendingTint } from "@/components/ui/pending-tint";
import { SectionHeading } from "@/components/ui/section-heading";
import {
  loadMonthlyClassSummary,
  loadMonthlyStudentReport,
  type MonthlyClassRow,
} from "@/lib/monthly-report";
import { loadUserState } from "@/lib/onboarding";
import {
  currentMonth,
  monthLabel,
  parseMonth,
  shiftMonth,
  type MonthKey,
} from "@/lib/report-period";
import {
  attendanceText,
  bandText,
  courseLabel,
  subtitleText,
} from "@/lib/report-text";
import {
  REPORT_STATUS_LABELS,
  formatPeriod,
  loadTeacherReports,
} from "@/lib/reports";
import { MEMBER_STATUS_LABELS } from "@/lib/score";
import { createClient } from "@/lib/supabase/server";
import { isUuid, type TeacherClassFields } from "@/lib/teacher";
import { cn } from "@/lib/utils";
import type { MemberStatus } from "@/lib/score";

export const metadata: Metadata = {
  title: "Báo cáo",
};

/**
 * The monthly parent reports — the Figma's `pages/teacher/Reports.tsx`.
 *
 * One route, three query parameters, two views:
 *
 *   - `?class=&month=` lists the class's students for that month with what the
 *     month actually holds for each of them, plus the whole-class workbook.
 *   - `?student=` adds the report preview for one of them, with the PDF, Word
 *     and Excel downloads.
 *
 * Every control is a `<Link>` and the downloads are plain `<a href>`s pointing
 * at `/teacher/reports/export`, so the whole workflow — pick a class, pick a
 * month, open a student, download a file — works with JavaScript disabled.
 * There is no new page: §2 asked for the existing Reports route with query
 * parameters, which is also how the class-detail tabs and the calendar week
 * already work.
 *
 * ## What changed from M22
 *
 * M22 read `monthly_reports` and, finding it empty, said so — correctly, because
 * nothing generated a report. M27 generates one, and not from that table:
 * `monthly_reports` requires a NOT NULL `snapshot` and freezes it on
 * publication, so it is where a report is *published and shared* from, not where
 * one is computed. `loadMonthlyStudentReport` computes from the source tables —
 * `class_sessions`, `session_attendance`, `lesson_logs`, `score_entries`,
 * `homework_assignments`, `v_member_current_band`,
 * `v_member_performance_status` — every one of which already carries the
 * teacher-scoped policy `class_id = any(app.my_class_ids())`. No migration, no
 * RLS change, no RPC, no service role, and no fabricated `monthly_reports` row
 * written to make a screen work.
 *
 * The published-report list M22 built is kept, below the roster, and appears
 * only when rows exist. It is the read side of a table this milestone still does
 * not write, and `share_token_hash` is still never selected.
 *
 * ## Round trips
 *
 * The class list comes off `TeacherContext` — M24's measured win, not undone
 * here. The index view issues the month summary and the published list in one
 * `Promise.all`; the summary itself is six reads for a roster of any size, so
 * thirty students do not mean thirty queries (§11). The student view settles
 * the membership first and alone, then issues everything else in one
 * `Promise.all` — the authorization answer gates the data, which is the same
 * order `loadStudentOverview` uses.
 */

type ReportsSearchParams = Promise<{
  class?: string | string[];
  month?: string | string[];
  student?: string | string[];
}>;

function firstOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

type Selection = {
  classId: string;
  month: MonthKey;
  membershipId: string | null;
};

/** Rebuilds the query string with one parameter changed. */
function hrefWith(
  current: Selection,
  change: Partial<Selection>,
): string {
  const next = { ...current, ...change };
  const params = new URLSearchParams();

  params.set("class", next.classId);
  params.set("month", next.month);
  if (next.membershipId) params.set("student", next.membershipId);

  return `/teacher/reports?${params.toString()}`;
}

/** The download URL for one format, from the same selection the page is on. */
function exportHref(
  current: Selection,
  format: "pdf" | "docx" | "xlsx",
): string {
  const params = new URLSearchParams();

  params.set("class", current.classId);
  params.set("month", current.month);
  if (current.membershipId) params.set("student", current.membershipId);
  params.set("format", format);

  return `/teacher/reports/export?${params.toString()}`;
}

/** The joined ← / → pair, the same control the calendar's week nav uses. */
const STEP =
  "relative flex items-center bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors outline-none hover:bg-track focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

/** `improving` green, `needs_attention` orange, `stable` the Figma's grey. */
const STATUS_TONES: Record<MemberStatus, "green" | "neutral" | "orange"> = {
  improving: "green",
  stable: "neutral",
  needs_attention: "orange",
};

export default async function TeacherReportsPage({
  searchParams,
}: {
  searchParams: ReportsSearchParams;
}) {
  const state = await loadUserState();

  if (state.kind === "anonymous") {
    redirect("/auth/login");
  }

  if (state.kind !== "teacher") {
    redirect("/");
  }

  // The class list comes off the context rather than from a query of its own.
  // `loadUserState` already read it to classify the caller, and re-reading it
  // here cost this page a whole extra Supabase round trip — the single change
  // with the largest measured effect in M24. A failed read never reaches this
  // line: it is reported one layer up as an unplaceable account.
  const classes = state.teacher.classes;

  if (classes.length === 0) {
    return (
      <PageShell width="4xl" align="start">
        <PageHeader
          title="Báo cáo"
          breadcrumb={[
            { label: "Tổng quan", href: "/teacher" },
            { label: "Báo cáo" },
          ]}
          meta={["Báo cáo tiến bộ hàng tháng gửi cho phụ huynh"]}
        />

        <EmptyState
          title="Bạn chưa tạo lớp học nào"
          description="Báo cáo được lập cho từng học viên trong một lớp học."
          action={
            <Button asChild>
              <Link href="/teacher/new">Tạo lớp học</Link>
            </Button>
          }
        />
      </PageShell>
    );
  }

  const params = await searchParams;

  const rawClass = firstOf(params.class);
  const rawStudent = firstOf(params.student);

  // A class the URL does not name — or names badly — falls back to the first of
  // the teacher's own classes, the same way `?week=` falls back to this week on
  // the calendar. It can only ever be one of `classes`, so a foreign id widens
  // nothing: it simply is not found and the page shows the teacher's own class.
  const selectedClass =
    classes.find(
      (entry) => rawClass !== undefined && entry.classId === rawClass,
    ) ?? classes[0];

  // `currentMonth` reads the class's own clock, never the server's — a report
  // for "this month" must mean the month the teacher's class is in (§4).
  const month =
    parseMonth(firstOf(params.month)) ?? currentMonth(selectedClass.timezone);

  const membershipId =
    rawStudent !== undefined && isUuid(rawStudent) ? rawStudent : null;

  const selected: Selection = {
    classId: selectedClass.classId,
    month,
    membershipId,
  };

  const supabase = await createClient();

  if (membershipId !== null) {
    return (
      <StudentView
        selected={selected}
        classFields={selectedClass}
        teacher={{
          fullName: state.teacher.fullName,
          email: state.teacher.email,
        }}
        supabase={supabase}
        membershipId={membershipId}
      />
    );
  }

  const [summary, published] = await Promise.all([
    loadMonthlyClassSummary(supabase, selectedClass, month),
    loadTeacherReports(supabase, classes),
  ]);

  const classPills: FilterPillItem[] = classes.map((entry) => ({
    label: entry.className,
    href: hrefWith(selected, { classId: entry.classId, membershipId: null }),
    current: entry.classId === selectedClass.classId,
  }));

  return (
    <PageShell width="4xl" align="start">
      <PageHeader
        title="Báo cáo"
        breadcrumb={[
          { label: "Tổng quan", href: "/teacher" },
          { label: "Báo cáo" },
        ]}
        meta={[
          monthLabel(month),
          `${selectedClass.className} · ${courseLabel(
            selectedClass.courseType,
            selectedClass.courseTypeOther,
          )}`,
        ]}
        actions={
          <>
            <Button asChild variant="outline" size="sm" className="relative">
              <a href={exportHref(selected, "xlsx")}>Tải Excel cả lớp</a>
            </Button>

            <MonthNav selected={selected} />
          </>
        }
      />

      {classes.length > 1 ? (
        <div className="mb-6">
          <FilterPills label="Lớp học" items={classPills} />
        </div>
      ) : null}

      {summary === null ? (
        <Alert>
          Chúng tôi chưa tải được dữ liệu báo cáo của lớp này. Vui lòng tải lại
          trang.
        </Alert>
      ) : summary.rows.length === 0 ? (
        <EmptyState
          title="Lớp này chưa có học viên nào"
          description="Báo cáo được lập cho từng học viên. Hãy mời học viên vào lớp trước."
          action={
            <Button asChild variant="outline">
              <Link href={`/teacher/${selectedClass.classId}`}>
                Mở lớp học
              </Link>
            </Button>
          }
        />
      ) : (
        <section>
          <SectionHeading
            title="Học viên"
            description={`${summary.rows.length} học viên · chọn một học viên để xem báo cáo ${monthLabel(month).toLowerCase()}`}
          />

          <ul className="space-y-3">
            {summary.rows.map((row) => (
              <li key={row.membershipId}>
                <StudentRow row={row} selected={selected} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {published !== null && published.length > 0 ? (
        <section className="mt-10">
          <SectionHeading
            title="Báo cáo đã phát hành"
            description="Các báo cáo đã được lưu và chia sẻ với phụ huynh."
          />

          <ul className="space-y-3">
            {published.map((report) => (
              <li key={report.reportId}>
                <Card variant="list">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0 grow basis-64">
                      <p className="text-xs text-muted-foreground">
                        {formatPeriod(report.periodMonth)}
                      </p>

                      <h3 className="mt-1 font-semibold break-words text-foreground">
                        {report.studentName ?? "Học viên chưa đặt tên"}
                      </h3>

                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {report.className}
                      </p>
                    </div>

                    <Badge
                      tone={report.status === "published" ? "green" : "neutral"}
                      className="shrink-0"
                    >
                      {REPORT_STATUS_LABELS[report.status]}
                    </Badge>
                  </div>

                  {report.teacherComment ? (
                    <p className="mt-3 rounded-lg bg-background p-3 text-sm break-words whitespace-pre-wrap text-muted-foreground italic">
                      {report.teacherComment}
                    </p>
                  ) : null}

                  <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">
                        Ngày phát hành
                      </dt>
                      <dd className="mt-0.5 text-sm text-foreground">
                        {report.publishedAt
                          ? MOMENT.format(new Date(report.publishedAt))
                          : "Chưa phát hành"}
                      </dd>
                    </div>

                    <div className="min-w-0">
                      <dt className="text-xs text-muted-foreground">
                        Liên kết chia sẻ
                      </dt>
                      <dd className="mt-0.5 text-sm text-foreground">
                        {report.shareRevokedAt
                          ? "Đã thu hồi"
                          : report.sharedAt
                            ? `Đã chia sẻ · ${report.shareViewCount} lượt xem`
                            : "Chưa chia sẻ"}
                      </dd>
                    </div>
                  </dl>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </PageShell>
  );
}

/**
 * The report preview for one student.
 *
 * The membership is settled by `loadMonthlyStudentReport` against the class id
 * that came off `TeacherContext`, so a `?student=` naming somebody else's
 * membership finds nothing. A stale or unknown id renders the alert rather than
 * a 404 — the same behaviour `?student=` has had on the class-detail roster
 * since M19, and for the same reason: the page the teacher asked for exists.
 */
async function StudentView({
  selected,
  classFields,
  teacher,
  supabase,
  membershipId,
}: {
  selected: Selection;
  classFields: TeacherClassFields;
  teacher: { fullName: string; email: string | null };
  supabase: Awaited<ReturnType<typeof createClient>>;
  membershipId: string;
}) {
  const result = await loadMonthlyStudentReport(
    supabase,
    classFields,
    teacher,
    membershipId,
    selected.month,
  );

  const back = hrefWith(selected, { membershipId: null });

  if (result.kind !== "ok") {
    return (
      <PageShell width="4xl" align="start">
        <PageHeader
          title="Báo cáo"
          breadcrumb={[
            { label: "Tổng quan", href: "/teacher" },
            { label: "Báo cáo", href: back },
            { label: "Học viên" },
          ]}
          meta={[monthLabel(selected.month)]}
        />

        <Alert>
          {result.kind === "not-found"
            ? "Không tìm thấy học viên này trong lớp. Có thể học viên đã được xóa khỏi lớp."
            : "Chúng tôi chưa tải được báo cáo này. Vui lòng tải lại trang."}
        </Alert>
      </PageShell>
    );
  }

  const report = result.report;

  return (
    <PageShell width="4xl" align="start">
      <PageHeader
        title={report.studentName ?? "Học viên"}
        breadcrumb={[
          { label: "Tổng quan", href: "/teacher" },
          { label: "Báo cáo", href: back },
          { label: report.studentName ?? "Học viên" },
        ]}
        meta={[subtitleText(report)]}
        actions={
          <>
            {/* Plain anchors, not `<Link>`: the target is a file response, not
                a route to navigate into. Each one names its own format, so the
                accessible name says what will arrive. */}
            <Button asChild size="sm">
              <a href={exportHref(selected, "pdf")}>Tải PDF</a>
            </Button>

            <Button asChild variant="outline" size="sm">
              <a href={exportHref(selected, "docx")}>Tải Word</a>
            </Button>

            <Button asChild variant="outline" size="sm">
              <a href={exportHref(selected, "xlsx")}>Tải Excel</a>
            </Button>

            <MonthNav selected={selected} />
          </>
        }
      />

      <ReportPreview report={report} />
    </PageShell>
  );
}

/**
 * Tháng này · ← · → over `?month=`.
 *
 * "Tháng này" drops the parameter rather than computing a month, so the answer
 * is always the class's own current month at the moment the link is followed.
 */
function MonthNav({ selected }: { selected: Selection }) {
  const params = new URLSearchParams();
  params.set("class", selected.classId);
  if (selected.membershipId) params.set("student", selected.membershipId);

  return (
    <>
      <Button asChild variant="outline" size="sm" className="relative">
        <Link href={`/teacher/reports?${params.toString()}`}>
          Tháng này
          <PendingTint />
        </Link>
      </Button>

      <div className="flex overflow-hidden rounded-lg border border-border">
        <Link
          href={hrefWith(selected, { month: shiftMonth(selected.month, -1) })}
          className={cn(STEP, "border-r border-border")}
        >
          <span aria-hidden>←</span>
          <span className="sr-only">Tháng trước</span>
          <PendingTint />
        </Link>

        <Link
          href={hrefWith(selected, { month: shiftMonth(selected.month, 1) })}
          className={STEP}
        >
          <span aria-hidden>→</span>
          <span className="sr-only">Tháng sau</span>
          <PendingTint />
        </Link>
      </div>
    </>
  );
}

/** One line of the roster: what the month holds for this student. */
function StudentRow({
  row,
  selected,
}: {
  row: MonthlyClassRow;
  selected: Selection;
}) {
  return (
    <Card variant="list" className="p-0">
      <Link
        href={hrefWith(selected, { membershipId: row.membershipId })}
        className="relative block rounded-xl p-5 outline-none transition-colors hover:bg-track focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 grow basis-56">
            <p className="font-semibold break-words text-foreground">
              {row.name ?? "Học viên chưa đặt tên"}
            </p>

            <p className="mt-0.5 text-sm text-muted-foreground">
              {row.email ?? "Chưa có email"}
            </p>
          </div>

          <Badge tone={STATUS_TONES[row.status]} className="shrink-0">
            {MEMBER_STATUS_LABELS[row.status]}
          </Badge>
        </div>

        <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Band hiện tại</dt>
            <dd className="mt-0.5 text-sm text-foreground">
              {bandText(row.currentOverall)}
            </dd>
          </div>

          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Band mục tiêu</dt>
            <dd className="mt-0.5 text-sm text-foreground">
              {bandText(row.targetBand)}
            </dd>
          </div>

          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Chuyên cần</dt>
            <dd className="mt-0.5 text-sm text-foreground">
              {attendanceText(row.attendance)}
            </dd>
          </div>

          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Trong tháng</dt>
            <dd className="mt-0.5 text-sm text-foreground">
              {`${row.lessonCount} ghi chú · ${row.scoreCount} lần ghi điểm`}
            </dd>
          </div>
        </dl>

        <PendingTint />
      </Link>
    </Card>
  );
}

const MOMENT = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Ho_Chi_Minh",
});
