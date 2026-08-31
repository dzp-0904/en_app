import { instantOf, zonedCalendarDate } from "@/lib/time";

/**
 * The reporting month, and where its edges fall on a class's own clock.
 *
 * A monthly report is a claim about a calendar month, and a calendar month is
 * not a fixed slice of the world's timeline: August in Ho Chi Minh City begins
 * seven hours before August in UTC and ends seven hours before it too. Two of
 * the tables a report reads store instants (`class_sessions.starts_at` is
 * `timestamptz`) and the rest store calendar squares (`lesson_logs.lesson_date`,
 * `score_entries.recorded_on`, `homework_assignments.due_date` are bare
 * `date`s). The two kinds need different treatment and this module is where the
 * difference is decided, once, rather than at each of the six queries.
 *
 * `monthBounds` therefore hands back two pairs:
 *
 *   - `firstDay` / `lastDay` — `YYYY-MM-DD` strings, for the `date` columns.
 *     A `date` was already resolved on the class's clock when it was written
 *     (that is what `zonedCalendarDate` is for), so comparing it to another
 *     calendar square needs no conversion at all.
 *   - `startsAt` / `endsAt` — ISO instants, for `timestamptz` columns, and
 *     half-open: `starts_at >= startsAt AND starts_at < endsAt`. The end is the
 *     next month's midnight rather than "the last day at 23:59:59", so a lesson
 *     beginning at 23:59:30 on the 31st is inside August and one beginning at
 *     00:00:00 on the 1st is not, with no gap and no overlap between them.
 *
 * `lib/time.ts` does the conversion; nothing here reimplements it, and
 * `toISOString().slice(0, 10)` appears nowhere — a UTC server asked for
 * "today in Ho Chi Minh City" at 22:00 local would answer with yesterday.
 */

/** A month as it travels in the URL and in `monthly_reports.period_month`. */
export type MonthKey = string;

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * Whether a query parameter is a month this application will act on.
 *
 * Strict rather than lenient: `2026-8`, `2026-13` and `august` are all refused
 * and the caller falls back to the current month. A month is the axis the whole
 * report hangs from, so guessing what a malformed one meant would produce a
 * confidently wrong document.
 *
 * The lower bound is 1970 and the upper 2999 — wide enough that no real class
 * is excluded, narrow enough that `?month=0000-01` does not reach `Date.UTC`.
 */
export function isMonthKey(value: string): value is MonthKey {
  const match = MONTH_KEY.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  return year >= 1970 && year <= 2999;
}

export function parseMonth(value: string | null | undefined): MonthKey | null {
  if (typeof value !== "string") return null;
  return isMonthKey(value) ? value : null;
}

/** The month it is right now where the class meets. */
export function currentMonth(zone: string): MonthKey {
  // `zonedCalendarDate` returns `YYYY-MM-DD` assembled from `Intl` parts on the
  // named zone, so the first seven characters are that zone's month.
  return zonedCalendarDate(zone, new Date().toISOString()).slice(0, 7);
}

/** The month `delta` months away — `-1` for the previous, `+1` for the next. */
export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const [year, index] = splitMonth(month);

  // Arithmetic on a month counter rather than on a Date: adding a month to
  // 31 January with `setMonth` lands on 2 or 3 March, which is not what "the
  // next month" means to anybody reading a report.
  const total = year * 12 + (index - 1) + delta;
  const shiftedYear = Math.floor(total / 12);
  const shiftedIndex = total - shiftedYear * 12 + 1;

  return `${String(shiftedYear).padStart(4, "0")}-${String(shiftedIndex).padStart(2, "0")}`;
}

/** "Tháng 08/2026". Numeric, for the reason `lib/time.ts` gives. */
export function monthLabel(month: MonthKey): string {
  const [year, index] = splitMonth(month);
  return `Tháng ${String(index).padStart(2, "0")}/${year}`;
}

export type MonthBounds = {
  /** `YYYY-MM-01` — for `date` columns, inclusive. */
  firstDay: string;
  /** The month's last calendar day — for `date` columns, inclusive. */
  lastDay: string;
  /** The instant the month begins on the class's clock — inclusive. */
  startsAt: string;
  /** The instant the next month begins on the class's clock — exclusive. */
  endsAt: string;
};

export function monthBounds(zone: string, month: MonthKey): MonthBounds {
  const next = shiftMonth(month, 1);

  const firstDay = `${month}-01`;
  const nextFirstDay = `${next}-01`;

  return {
    firstDay,
    lastDay: dayBefore(nextFirstDay),
    startsAt: instantOf(zone, firstDay, "00:00").toISOString(),
    endsAt: instantOf(zone, nextFirstDay, "00:00").toISOString(),
  };
}

/**
 * Whether a calendar square falls inside the month.
 *
 * String comparison, not date arithmetic: both sides are `YYYY-MM-DD`, a format
 * whose lexical order is its chronological order, and a `date` column never
 * carries a time to be lost.
 */
export function isInMonth(month: MonthKey, calendarDate: string): boolean {
  return calendarDate.slice(0, 7) === month;
}

function splitMonth(month: MonthKey): [number, number] {
  return [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
}

/**
 * The calendar day before a `YYYY-MM-DD`.
 *
 * `Date.UTC` is safe here because both the input and the output are calendar
 * squares with no zone attached: this is arithmetic on a label, and midnight
 * UTC is only the arbitrary anchor the arithmetic happens at. The result is
 * assembled from `getUTC*` rather than sliced off an ISO string, which is the
 * same rule `zonedCalendarDate` follows.
 */
function dayBefore(calendarDate: string): string {
  const [year, month, day] = calendarDate.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day - 1));

  return [
    String(previous.getUTCFullYear()).padStart(4, "0"),
    String(previous.getUTCMonth() + 1).padStart(2, "0"),
    String(previous.getUTCDate()).padStart(2, "0"),
  ].join("-");
}
