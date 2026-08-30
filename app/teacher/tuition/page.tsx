import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { StatCard } from "@/components/ui/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { loadUserState } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import { loadTeacherClassList } from "@/lib/teacher";
import {
  PAYMENT_STATUS_LABELS,
  formatMoney,
  formatPeriod,
  loadTeacherTuition,
  summarise,
  type PaymentStatus,
} from "@/lib/tuition";

export const metadata: Metadata = {
  title: "Học phí",
};

/**
 * The tuition ledger — the Figma's `pages/teacher/Tuition.tsx`.
 *
 * A real read of `tuition_records` under `tuition_records_teacher_all`, which
 * is the only policy on that table: the migration's own comment says students
 * never see these rows, so nothing in the student half of the product links
 * here and no student query touches it.
 *
 * The Figma's three summary cards and its ledger table are both reproduced. Two
 * things are the schema's rather than the mock's, and `lib/tuition.ts` explains
 * both: `public.payment_status` has no "overdue" value and there is no due date
 * for anything to be late against, so the statuses are paid / pending / waived;
 * and `amount_total` is a generated column that is read, never recomputed.
 *
 * There is no "Send reminder" button. `reminder_sent_at` and `reminder_count`
 * exist, but sending a reminder means sending mail to a real family about real
 * money, and nothing in this application writes those columns yet. A button
 * that only looked like it sent one would be worse than no button.
 */

/** The enum's three values, in the order the ledger reads best. */
const STATUS_TONE: Record<PaymentStatus, "green" | "orange" | "neutral"> = {
  paid: "green",
  pending: "orange",
  waived: "neutral",
};

export default async function TeacherTuitionPage() {
  const state = await loadUserState();

  if (state.kind === "anonymous") {
    redirect("/auth/login");
  }

  if (state.kind !== "teacher") {
    redirect("/");
  }

  const supabase = await createClient();
  const classes = await loadTeacherClassList(supabase, state.teacher.userId);

  const records =
    classes === null ? null : await loadTeacherTuition(supabase, classes);

  const summary = records === null ? null : summarise(records);

  return (
    <PageShell width="4xl" align="start">
      <PageHeader
        title="Học phí"
        breadcrumb={[
          { label: "Tổng quan", href: "/teacher" },
          { label: "Học phí" },
        ]}
        meta={["Sổ theo dõi học phí của các lớp bạn đang dạy"]}
      />

      {classes === null || records === null || summary === null ? (
        <Alert>
          Chúng tôi chưa tải được sổ học phí. Vui lòng tải lại trang.
        </Alert>
      ) : classes.length === 0 ? (
        <EmptyState
          title="Bạn chưa tạo lớp học nào"
          description="Học phí được ghi nhận theo từng học viên trong một lớp học."
          action={
            <Button asChild>
              <Link href="/teacher/new">Tạo lớp học</Link>
            </Button>
          }
        />
      ) : records.length === 0 ? (
        <EmptyState
          title="Chưa có khoản học phí nào"
          description="Tính năng ghi nhận học phí chưa khả dụng. Khi có khoản học phí, toàn bộ sổ theo dõi sẽ hiển thị tại đây."
          action={
            <Button asChild variant="outline">
              <Link href="/teacher/classes">Xem lớp học</Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* The Figma's three cards: label above a bold, coloured number and
              no tinted mark — the Dashboard's dotted tile is a different
              object. Every figure is a sum of `amount_total` as stored — see
              `summarise` for why a waived row is counted as expected but never
              as outstanding. */}
          <div className="mb-8 grid gap-4 sm:grid-cols-3">
            <StatCard
              layout="label-first"
              label="Tổng học phí"
              value={formatMoney(summary.expected, summary.currency)}
            />
            <StatCard
              layout="label-first"
              valueTone="green"
              label="Đã thu"
              value={formatMoney(summary.collected, summary.currency)}
            />
            <StatCard
              layout="label-first"
              valueTone="orange"
              label="Còn phải thu"
              value={formatMoney(summary.outstanding, summary.currency)}
            />
          </div>

          <Table label="Sổ học phí">
            <TableHeader>
              <TableRow>
                <TableHead>Học viên</TableHead>
                <TableHead>Kỳ</TableHead>
                <TableHead>Buổi học</TableHead>
                <TableHead>Số tiền</TableHead>
                <TableHead>Trạng thái</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {records.map((record) => (
                <TableRow key={record.recordId}>
                  <TableCell>
                    <span className="font-medium text-foreground">
                      {record.studentName ?? "Học viên chưa đặt tên"}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {record.className}
                    </span>
                  </TableCell>

                  <TableCell className="whitespace-nowrap">
                    {formatPeriod(record.periodMonth)}
                  </TableCell>

                  {/* Attended and billed are separate columns and are not the
                      same number — a billed session the student missed is
                      still billed. Both are shown rather than one. */}
                  <TableCell className="whitespace-nowrap">
                    {`${record.sessionsAttended}/${record.sessionsBilled}`}
                  </TableCell>

                  <TableCell className="whitespace-nowrap">
                    <span className="font-medium text-foreground">
                      {record.amountTotal === null
                        ? "—"
                        : formatMoney(record.amountTotal, record.currency)}
                    </span>
                    {record.discountAmount > 0 ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {`Giảm ${formatMoney(record.discountAmount, record.currency)}`}
                      </span>
                    ) : null}
                  </TableCell>

                  <TableCell>
                    <Badge tone={STATUS_TONE[record.status]}>
                      {PAYMENT_STATUS_LABELS[record.status]}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </PageShell>
  );
}
