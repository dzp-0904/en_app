import "server-only";

import type { Database } from "@/lib/database.types";
import type { createClient } from "@/lib/supabase/server";
import type { TeacherClassFields } from "@/lib/teacher";
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
  /**
   * Minutes past midnight on the class's own clock — where in the day column
   * the block starts, and how tall it is.
   *
   * Derived from `startTime`/`endTime` rather than from the instant, so the
   * offset and the printed time can never disagree: both are the same wall
   * clock, read once through `lib/time.ts`.
   */
  startMinutes: number;
  /**
   * Exclusive, and clamped to midnight. A lesson that runs past midnight ends
   * on the next calendar square, and its block stops at the bottom of this one
   * rather than wrapping into a day it does not belong to.
   */
  endMinutes: number;
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

/**
 * The time grid's geometry, exactly as `pages/teacher/Calendar.tsx` sets it:
 * `HOUR_START = 6`, `HOUR_END = 22`, `SLOT_HEIGHT = 64` — a sixteen-hour day at
 * 64px an hour, with the hour rule solid and the half-hour rule dashed.
 *
 * These are a floor and a ceiling rather than a fixed window; see `gridRange`.
 */
export const HOUR_START = 6;
export const HOUR_END = 22;
export const SLOT_HEIGHT = 64;

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

/**
 * The same seven days as they are written at the top of a Vietnamese calendar.
 *
 * The Figma prints "MON"…"SUN". Vietnamese numbers its weekdays rather than
 * naming them, and "T2"…"T7" / "CN" is the form every printed calendar,
 * timetable and phone in the country uses — it is also two characters, which is
 * what lets a day column stay narrow. The full name is still carried by each
 * column's accessible label.
 */
export const WEEKDAY_SHORT = [
  "T2",
  "T3",
  "T4",
  "T5",
  "T6",
  "T7",
  "CN",
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

/**
 * `HH:mm` as minutes past midnight.
 *
 * `% 24` because `Intl` renders midnight as "24:00" under an h24 locale and as
 * "00:00" under h23, and which one a runtime picks for `vi-VN` is not something
 * to bet a lesson's position on.
 */
export function minutesOfDay(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return (hour % 24) * 60 + minute;
}

/** Today, on the clock the classes actually meet on. */
export function todayIn(zone: string): string {
  return zonedCalendarDate(zone, new Date().toISOString());
}

/**
 * Now, on that same clock: which square today is, and how far into it we are.
 *
 * Both halves come from `lib/time.ts` against one instant, which is what keeps
 * the highlighted column and the current-time line from disagreeing across a
 * midnight boundary. Read once per request on the server — the line marks when
 * the page was rendered, exactly as the Figma's own `new Date()` does.
 */
export function nowIn(zone: string): { date: string; minutes: number } {
  const instant = new Date().toISOString();
  return {
    date: zonedCalendarDate(zone, instant),
    minutes: minutesOfDay(formatZonedTime(zone, instant)),
  };
}

/**
 * The hours the grid spans.
 *
 * The Figma's window is 06:00–22:00 and that is the floor and the ceiling here.
 * It is widened — never narrowed — when a real lesson falls outside it: a block
 * positioned off the grid would simply not be drawn, and a calendar that
 * silently omits a lesson is a worse object than a calendar that is taller.
 * Every class in this product meets inside the Figma's window, so in practice
 * the returned range is the Figma's.
 */
export function gridRange(sessions: CalendarSession[]): {
  startHour: number;
  endHour: number;
} {
  let startHour = HOUR_START;
  let endHour = HOUR_END;

  for (const session of sessions) {
    startHour = Math.min(startHour, Math.floor(session.startMinutes / 60));
    endHour = Math.max(endHour, Math.ceil(session.endMinutes / 60));
  }

  return { startHour, endHour: Math.max(endHour, startHour + 1) };
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
export function calendarZone(classes: TeacherClassFields[]): string {
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
  classes: TeacherClassFields[],
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

    const startTime = formatZonedTime(owner.timezone, session.starts_at);
    const endTime = formatZonedTime(owner.timezone, session.ends_at);
    const startMinutes = minutesOfDay(startTime);
    const rawEnd = minutesOfDay(endTime);

    placed.push({
      sessionId: session.id,
      classId: session.class_id,
      className: owner.className,
      title: session.title,
      status: session.status,
      date,
      startTime,
      endTime,
      startMinutes,
      // Anything that does not run forwards inside this square ran past
      // midnight. `class_sessions_ends_after_starts` guarantees the instants
      // are ordered, so this is the only case that can produce it.
      endMinutes: rawEnd > startMinutes ? rawEnd : 24 * 60,
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

/** `dd/MM` — the date spoken in a column's accessible label. */
export function dayLabel(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return day + "/" + month;
}

/** The bare day of the month, which is all the Figma's column heading prints. */
export function dayNumber(isoDate: string): string {
  return String(Number(isoDate.split("-")[2]));
}
