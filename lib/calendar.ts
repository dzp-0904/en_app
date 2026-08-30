import "server-only";

import type { Database } from "@/lib/database.types";
import type { createClient } from "@/lib/supabase/server";
import type { TeacherClass } from "@/lib/teacher";
import { formatZonedTime, zonedCalendarDate } from "@/lib/time";

/**
 * The teaching week, assembled from the sessions that were actually scheduled.
 *
 * WHAT THE FIGMA DOES AND WHY THIS DOES NOT. `pages/teacher/Calendar.tsx`
 * builds its week by parsing each class's free-text `schedule` — reading
 * "Tuesday & Thursday, 7:30 PM" with a regular expression and synthesising a
 * 90-minute block on every matching day, forever. This product has real
 * sessions: `class_sessions` carries `starts_at`, `ends_at`, `title` and
 * `status` per lesson, `classes.schedule_note` is display-only by the
 * migration's own comment, and `lib/teacher.ts` already reads all of it. So the
 * calendar is drawn from the rows rather than from the sentence, and a lesson
 * that was moved or cancelled is shown where it actually is.
 *
 * TIMEZONES. Every class carries its own IANA zone and `starts_at` is a
 * `timestamptz`, i.e. an instant. Which calendar square a lesson belongs in is
 * therefore a per-class question, and it is answered per class:
 * `zonedCalendarDate(entry.timezone, session.starts_at)`. The query window is
 * deliberately wider than the week on each side, because a UTC instant inside
 * the week for one zone can be outside it for another; the widening costs one
 * comparison and the bucketing is what actually decides membership. Nothing
 * here reads the server's clock zone, and nothing calls
 * `toISOString().slice(0, 10)` on a session.
 *
 * WEEK ARITHMETIC IS CALENDAR ARITHMETIC. `weekStart` and its neighbours
 * operate on `YYYY-MM-DD` squares through `Date.UTC`, which is exact for whole
 * days and has no zone in it to get wrong. Only the instants go through
 * `lib/time.ts`.
 */

export type SessionStatus = Database["public"]["Enums"]["session_status"];

/** One lesson, placed on the class's own clock. */
export type CalendarSession = {
  sessionId: string;
  classId: string;
  className: string;
  title: string | null;
  status: SessionStatus;
  /** `YYYY-MM-DD` in the class's zone — which square this lesson sits in. */
  date: string;
  /** `HH:mm` in the class's zone. */
  startTime: string;
  endTime: string;
  /** The raw instant, kept for ordering across zones. */
  startsAt: string;
};

/**
 * The four tones a class can be drawn in, matching the Figma's `CLASS_COLORS`.
 *
 * Assigned by the class's position in the teacher's own list, which is stable
 * for a given teacher, so a class keeps its colour between visits. These are
 * `ProgressBar`'s tones — existing tokens doing a second job rather than a new
 * palette — and the colour is never the only carrier of meaning: every block
 * prints its class name, and the legend prints it again beside the swatch.
 */
export const CLASS_TONES = ["primary", "green", "orange", "navy"] as const;

export type ClassTone = (typeof CLASS_TONES)[number];

export const TONE_BLOCK: Record<ClassTone, string> = {
  primary: "border-l-primary bg-secondary text-primary-hover",
  green: "border-l-green bg-green-light text-green-dark",
  orange: "border-l-orange bg-orange-light text-orange-dark",
  navy: "border-l-navy bg-muted text-foreground",
};

export const TONE_DOT: Record<ClassTone, string> = {
  primary: "bg-primary",
  green: "bg-green",
  orange: "bg-orange",
  navy: "bg-navy",
};

/** Weekday names, Monday first — the week Vietnamese calendars start on. */
export const WEEKDAY_LABELS = [
  "Thứ Hai",
  "Thứ Ba",
  "Thứ Tư",
  "Thứ Năm",
  "Thứ Sáu",
  "Thứ Bảy",
  "Chủ Nhật",
] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const DAY = 86_400_000;

/** A calendar square as a UTC midnight, so day arithmetic is exact. */
function squareOf(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function squareToIso(instant: number): string {
  const date = new Date(instant);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return date.getUTCFullYear() + "-" + month + "-" + day;
}

/** The Monday of the week `isoDate` falls in. */
export function weekStart(isoDate: string): string {
  const square = squareOf(isoDate);
  // getUTCDay: 0 = Sunday. Monday-first means Sunday is six days in.
  const weekday = new Date(square).getUTCDay();
  const back = (weekday + 6) % 7;
  return squareToIso(square - back * DAY);
}

/**
 * Accepts what `?week=` may carry, or nothing at all.
 *
 * A malformed or impossible value falls back to the current week rather than
 * throwing: the parameter is in the URL, so anyone can type anything into it,
 * and the right answer to "2026-02-31" is this week rather than a 500. The
 * round-trip through `Date` is what catches a date that parses but normalises.
 */
export function readWeekParam(
  raw: string | undefined,
  fallback: string,
): string {
  if (!raw || !ISO_DATE.test(raw)) return weekStart(fallback);

  const parsed = new Date(raw + "T00:00:00Z");
  if (Number.isNaN(parsed.getTime())) return weekStart(fallback);
  if (squareToIso(parsed.getTime()) !== raw) return weekStart(fallback);

  return weekStart(raw);
}

/** The seven squares of the week starting at `monday`. */
export function weekDays(monday: string): string[] {
  const start = squareOf(monday);
  return Array.from({ length: 7 }, (_, index) =>
    squareToIso(start + index * DAY),
  );
}

export function shiftWeek(monday: string, weeks: number): string {
  return squareToIso(squareOf(monday) + weeks * 7 * DAY);
}

/** Today, on the clock the classes actually meet on. */
export function todayIn(zone: string): string {
  return zonedCalendarDate(zone, new Date().toISOString());
}

/**
 * The zone the calendar's own "today" is read on.
 *
 * A teacher's classes could in principle sit in different zones, and there is
 * no single right answer to "what day is it" in that case. The first class's
 * zone is used, because `classes.timezone` defaults to `'Asia/Ho_Chi_Minh'` and
 * every real class in this product shares it — and the choice only affects
 * which column is marked as today, never which square a lesson lands in.
 */
export function calendarZone(classes: TeacherClass[]): string {
  return classes[0]?.timezone ?? "Asia/Ho_Chi_Minh";
}

function logDbError(
  operation: string,
  error: { code?: string; message?: string },
): void {
  console.error("[calendar] " + operation + " failed", {
    code: error.code,
    message: error.message,
  });
}

/**
 * Every session of the teacher's classes that falls inside `days`.
 *
 * One statement across all the classes rather than one per class. The filter is
 * `class_id in (…)` over ids that came from a query already restricted to
 * `teacher_id = <session user>`, and `class_sessions_teacher_all` resolves the
 * same ownership through `app.my_class_ids()` underneath.
 *
 * `null` means the query failed. `[]` means a genuinely empty week, and the
 * page says so rather than showing a grid that might merely have failed to
 * load.
 */
export async function loadTeacherWeek(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classes: TeacherClass[],
  days: string[],
): Promise<CalendarSession[] | null> {
  if (classes.length === 0 || days.length === 0) return [];

  const first = squareOf(days[0]);
  const last = squareOf(days[days.length - 1]);

  const { data: sessions, error } = await supabase
    .from("class_sessions")
    .select("id, class_id, starts_at, ends_at, title, status")
    .in(
      "class_id",
      classes.map((entry) => entry.classId),
    )
    // Two days of slack on each side: the same instant can sit on either side
    // of a boundary depending on the zone it is read in, and the bucketing
    // below is what actually decides. No zone offset comes close to 48 hours.
    .gte("starts_at", new Date(first - 2 * DAY).toISOString())
    .lt("starts_at", new Date(last + 3 * DAY).toISOString())
    .order("starts_at", { ascending: true });

  if (error) {
    logDbError("class_sessions.select", error);
    return null;
  }

  const byId = new Map(classes.map((entry) => [entry.classId, entry]));
  const wanted = new Set(days);
  const placed: CalendarSession[] = [];

  for (const session of sessions ?? []) {
    const owner = byId.get(session.class_id);
    if (!owner) continue;

    const date = zonedCalendarDate(owner.timezone, session.starts_at);
    if (!wanted.has(date)) continue;

    placed.push({
      sessionId: session.id,
      classId: session.class_id,
      className: owner.className,
      title: session.title,
      status: session.status,
      date,
      startTime: formatZonedTime(owner.timezone, session.starts_at),
      endTime: formatZonedTime(owner.timezone, session.ends_at),
      startsAt: session.starts_at,
    });
  }

  return placed;
}

/** The month heading above the grid, e.g. "Tháng 08/2026". */
export function weekLabel(days: string[]): string {
  const [firstYear, firstMonth] = days[0].split("-");
  const [lastYear, lastMonth] = days[days.length - 1].split("-");

  if (firstYear === lastYear && firstMonth === lastMonth) {
    return "Tháng " + firstMonth + "/" + firstYear;
  }

  if (firstYear === lastYear) {
    return "Tháng " + firstMonth + "–" + lastMonth + "/" + firstYear;
  }

  return (
    "Tháng " + firstMonth + "/" + firstYear + " – " + lastMonth + "/" + lastYear
  );
}

/** `dd/MM` — the number under each weekday heading. */
export function dayLabel(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return day + "/" + month;
}
