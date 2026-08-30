import "server-only";

import type { Database } from "@/lib/database.types";
import type { createClient } from "@/lib/supabase/server";
import type { TeacherClassFields } from "@/lib/teacher";

/**
 * The teacher's tuition ledger.
 *
 * `tuition_records` is a real table with a real policy. The migration's own
 * comment calls it a "teacher-only ledger. Students never see these rows", and
 * `tuition_records_teacher_all` is the only policy on it — there is no student
 * SELECT. That is why this screen lives under `/teacher` and why nothing in the
 * student half of the product links to it or reads from it.
 *
 * As with `monthly_reports`, the table exists and nothing in this application
 * writes to it yet. Recording a payment is a money operation, not a visual one:
 * it needs a decision about who may mark a row paid, what a reminder actually
 * sends, and what happens to `reminder_count`. So this milestone reads the
 * ledger and does not write it, and an empty ledger is reported as empty rather
 * than filled with the Figma's `tuitionData` array.
 *
 * TWO DIVERGENCES FROM THE FIGMA, BOTH THE SCHEMA'S.
 *
 * `public.payment_status` is `('pending', 'paid', 'waived')`. The Figma's
 * status column is paid / pending / overdue, and "overdue" is not a value this
 * database can hold — there is no due date on the table for anything to be late
 * against. "Waived" is, and it is a real thing a teacher does. The three
 * statuses below are the enum, not the mock.
 *
 * `amount_total` is a GENERATED column: `sessions_billed * rate_per_session -
 * discount_amount`. It is read, never computed here. A second copy of that
 * arithmetic in page code would be a second chance for the teacher's screen and
 * the ledger to disagree about what is owed.
 *
 * `null` means the query failed, `[]` means nothing has been billed.
 */

export type PaymentStatus = Database["public"]["Enums"]["payment_status"];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  paid: "Đã thanh toán",
  pending: "Chưa thanh toán",
  waived: "Được miễn",
};

export type TuitionRecord = {
  recordId: string;
  classId: string;
  className: string;
  membershipId: string;
  studentName: string | null;
  /** `period_month` is a `date` constrained to the first of the month. */
  periodMonth: string;
  sessionsAttended: number;
  sessionsBilled: number;
  ratePerSession: number;
  discountAmount: number;
  /** The generated column, read as stored. Null only if the row is malformed. */
  amountTotal: number | null;
  currency: string;
  status: PaymentStatus;
  paidAt: string | null;
  reminderSentAt: string | null;
  reminderCount: number;
};

export type TuitionSummary = {
  /** Everything billed in the period, waived rows included. */
  expected: number;
  collected: number;
  outstanding: number;
  currency: string;
};

const COLUMNS =
  "id, class_id, class_member_id, period_month, sessions_attended, sessions_billed, rate_per_session, discount_amount, amount_total, currency, status, paid_at, reminder_sent_at, reminder_count, class_members!tuition_records_member_fk(invited_name, profiles!class_members_student_id_fkey(full_name))";

function logDbError(
  operation: string,
  error: { code?: string; message?: string },
): void {
  console.error("[tuition] " + operation + " failed", {
    code: error.code,
    message: error.message,
  });
}

export async function loadTeacherTuition(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classes: TeacherClassFields[],
): Promise<TuitionRecord[] | null> {
  if (classes.length === 0) return [];

  const names = new Map(classes.map((entry) => [entry.classId, entry.className]));

  const { data: records, error } = await supabase
    .from("tuition_records")
    .select(COLUMNS)
    .in("class_id", Array.from(names.keys()))
    .order("period_month", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    logDbError("tuition_records.select", error);
    return null;
  }

  return (records ?? []).map((record) => ({
    recordId: record.id,
    classId: record.class_id,
    className: names.get(record.class_id) ?? "",
    membershipId: record.class_member_id,
    studentName:
      record.class_members?.profiles?.full_name ??
      record.class_members?.invited_name ??
      null,
    periodMonth: record.period_month,
    sessionsAttended: record.sessions_attended,
    sessionsBilled: record.sessions_billed,
    ratePerSession: record.rate_per_session,
    discountAmount: record.discount_amount,
    amountTotal: record.amount_total,
    currency: record.currency,
    status: record.status,
    paidAt: record.paid_at,
    reminderSentAt: record.reminder_sent_at,
    reminderCount: record.reminder_count,
  }));
}

/**
 * What the three summary cards add up to.
 *
 * A waived row is billed but will never be collected, so it counts towards
 * neither `collected` nor `outstanding` — showing it as owing would make the
 * teacher chase money they decided not to take. It stays in `expected` because
 * the discount is what the card is there to make visible.
 */
export function summarise(records: TuitionRecord[]): TuitionSummary {
  let expected = 0;
  let collected = 0;
  let outstanding = 0;

  for (const record of records) {
    const amount = record.amountTotal ?? 0;
    expected += amount;
    if (record.status === "paid") collected += amount;
    else if (record.status === "pending") outstanding += amount;
  }

  return {
    expected,
    collected,
    outstanding,
    // `currency` is `char(3) default 'VND'` and every row in a teacher's ledger
    // is theirs, so the first row's currency is the ledger's. With no rows
    // there is nothing to total and the default is what the next row will use.
    currency: records[0]?.currency ?? "VND",
  };
}

/**
 * An amount as Vietnamese money — "2.400.000 ₫".
 *
 * `Intl.NumberFormat` with the currency style rather than the Figma's
 * hand-appended "đ", so the grouping separators are the ones a `vi-VN` reader
 * expects and the symbol is placed where the locale puts it. `rate_per_session`
 * and `amount_total` are `bigint` columns holding whole dong — there are no
 * minor units to scale by, which is why nothing is divided by 100 here.
 */
const MONEY = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: number, currency: string): string {
  const key = currency;
  let formatter = MONEY.get(key);

  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat("vi-VN", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      });
    } catch {
      // `currency` is `char(3)` with no check constraint, so a row written
      // outside this application could name a code `Intl` rejects. A number
      // with its code beside it beats a 500 on the whole ledger.
      console.error("[tuition] unknown currency", { currency });
      formatter = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
    }

    MONEY.set(key, formatter);
  }

  return formatter.format(amount);
}

/** `period_month` as "Tháng 08/2026". It is always the first of a month. */
export function formatPeriod(periodMonth: string): string {
  const [year, month] = periodMonth.split("-");
  return "Tháng " + month + "/" + year;
}
