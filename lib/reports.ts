import "server-only";

import type { Database } from "@/lib/database.types";
import type { createClient } from "@/lib/supabase/server";
import type { TeacherClass } from "@/lib/teacher";

/**
 * The monthly parent reports a teacher has generated.
 *
 * WHAT THE MILESTONE EXPECTED TO FIND, AND WHAT IS ACTUALLY THERE.
 * `monthly_reports` is a real table — `20260828000500_tables_homework_reports_
 * tuition.sql` — with a `(class_member_id, period_month)` unique key, a
 * `snapshot jsonb` and its `snapshot_version`, a `teacher_comment`, a
 * draft/published `status`, and a whole share-link apparatus
 * (`share_token_hash`, `shared_at`, `share_expires_at`, `share_revoked_at`,
 * `share_view_count`). It has an RLS policy, `monthly_reports_teacher_all`, and
 * grants to `authenticated`. So this page is a real read of a real table under
 * a real policy — not a mock, and not an invented data model.
 *
 * What does not exist is a *writer*. No code in this application inserts a
 * `monthly_reports` row, and `create_report_share_link` / `revoke_report_share_
 * link` / `get_shared_report` are RPCs nothing calls yet. Generating a report
 * means deciding what a snapshot contains and what a parent is allowed to see
 * through a share link, and neither is a visual question — so this milestone
 * reads and does not write. When the table is empty the page says the table is
 * empty, which is the truth, rather than showing a demonstration report built
 * from someone's real bands.
 *
 * The Figma's `pages/teacher/Reports.tsx` renders a single, fully-populated
 * report from `mockStudents` and draws two recharts charts inside it. Neither
 * the chart library nor the mock is brought over. What is brought over is the
 * screen's actual structure — a per-student, per-month record with its
 * publication and sharing state — because that is what the table stores.
 *
 * `null` means the query failed, `[]` means no report has been generated.
 */

export type ReportStatus = Database["public"]["Enums"]["report_status"];

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  draft: "Bản nháp",
  published: "Đã phát hành",
};

export type TeacherReport = {
  reportId: string;
  classId: string;
  className: string;
  membershipId: string;
  studentName: string | null;
  /** `period_month` is a `date` constrained to the first of the month. */
  periodMonth: string;
  status: ReportStatus;
  teacherComment: string | null;
  publishedAt: string | null;
  /**
   * When a share link was created, and whether it has since been revoked.
   *
   * Never the token. `share_token_hash` is a `bytea` digest and is not selected
   * — a page has no use for it, and the column exists precisely so the link
   * itself is not recoverable from the row.
   */
  sharedAt: string | null;
  shareRevokedAt: string | null;
  shareViewCount: number;
};

const COLUMNS =
  "id, class_id, class_member_id, period_month, status, teacher_comment, published_at, shared_at, share_revoked_at, share_view_count, class_members!monthly_reports_member_fk(invited_name, profiles!class_members_student_id_fkey(full_name))";

function logDbError(
  operation: string,
  error: { code?: string; message?: string },
): void {
  console.error("[reports] " + operation + " failed", {
    code: error.code,
    message: error.message,
  });
}

export async function loadTeacherReports(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classes: TeacherClass[],
): Promise<TeacherReport[] | null> {
  if (classes.length === 0) return [];

  const names = new Map(classes.map((entry) => [entry.classId, entry.className]));

  const { data: reports, error } = await supabase
    .from("monthly_reports")
    .select(COLUMNS)
    .in("class_id", Array.from(names.keys()))
    .order("period_month", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    logDbError("monthly_reports.select", error);
    return null;
  }

  return (reports ?? []).map((report) => ({
    reportId: report.id,
    classId: report.class_id,
    className: names.get(report.class_id) ?? "",
    membershipId: report.class_member_id,
    studentName:
      report.class_members?.profiles?.full_name ??
      report.class_members?.invited_name ??
      null,
    periodMonth: report.period_month,
    status: report.status,
    teacherComment: report.teacher_comment,
    publishedAt: report.published_at,
    sharedAt: report.shared_at,
    shareRevokedAt: report.share_revoked_at,
    shareViewCount: report.share_view_count,
  }));
}

/** `period_month` as "Tháng 08/2026". It is always the first of a month. */
export function formatPeriod(periodMonth: string): string {
  const [year, month] = periodMonth.split("-");
  return "Tháng " + month + "/" + year;
}
