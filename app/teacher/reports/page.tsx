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
import { loadUserState } from "@/lib/onboarding";
import {
  REPORT_STATUS_LABELS,
  formatPeriod,
  loadTeacherReports,
} from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";
import { loadTeacherClassList } from "@/lib/teacher";

export const metadata: Metadata = {
  title: "Báo cáo",
};

/**
 * The monthly parent reports — the Figma's `pages/teacher/Reports.tsx`.
 *
 * A real read of `monthly_reports` under `monthly_reports_teacher_all`. See
 * `lib/reports.ts` for why this screen reads and does not write: the table,
 * its policy, its grants and its three share-link RPCs all exist, and what does
 * not exist is any code that generates a report. Generating one means deciding
 * what the `snapshot jsonb` contains and what a parent may see through a share
 * link, and neither is a visual question this milestone can answer.
 *
 * So an empty table is reported as an empty table. The Figma's screen shows one
 * fully-populated report assembled from `mockStudents` and draws two recharts
 * charts inside it; copying that here would put a demonstration report, built
 * from real students' real bands, in front of a teacher as though it were
 * something they had made. The empty state says plainly that no report has been
 * created and that creating one is not available yet — which is the difference
 * between a screen that is honest about its state and a screen that lies
 * quietly.
 *
 * `share_token_hash` is never selected. It is a `bytea` digest and the column
 * exists precisely so the link itself cannot be recovered from the row; what is
 * shown is whether a link was made, whether it was revoked, and how many times
 * it was opened.
 */

const MOMENT = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Ho_Chi_Minh",
});

export default async function TeacherReportsPage() {
  const state = await loadUserState();

  if (state.kind === "anonymous") {
    redirect("/auth/login");
  }

  if (state.kind !== "teacher") {
    redirect("/");
  }

  const supabase = await createClient();
  const classes = await loadTeacherClassList(supabase, state.teacher.userId);

  const reports =
    classes === null ? null : await loadTeacherReports(supabase, classes);

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

      {classes === null || reports === null ? (
        <Alert>
          Chúng tôi chưa tải được báo cáo của bạn. Vui lòng tải lại trang.
        </Alert>
      ) : classes.length === 0 ? (
        <EmptyState
          title="Bạn chưa tạo lớp học nào"
          description="Báo cáo được lập cho từng học viên trong một lớp học."
          action={
            <Button asChild>
              <Link href="/teacher/new">Tạo lớp học</Link>
            </Button>
          }
        />
      ) : reports.length === 0 ? (
        <EmptyState
          title="Chưa có báo cáo nào"
          description="Tính năng lập báo cáo hàng tháng chưa khả dụng. Khi có báo cáo, tất cả sẽ được liệt kê tại đây. Trong lúc chờ, bạn có thể xem tiến bộ của từng học viên trong trang lớp học."
          action={
            <Button asChild variant="outline">
              <Link href="/teacher/classes">Xem lớp học</Link>
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {reports.map((report) => (
            <li key={report.reportId}>
              <Card variant="list">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0 grow basis-64">
                    <p className="text-xs text-muted-foreground">
                      {formatPeriod(report.periodMonth)}
                    </p>

                    <h2 className="mt-1 font-semibold break-words text-foreground">
                      {report.studentName ?? "Học viên chưa đặt tên"}
                    </h2>

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
      )}
    </PageShell>
  );
}
