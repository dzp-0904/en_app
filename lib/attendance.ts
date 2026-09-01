import type { Database } from "./database.types";

/**
 * `public.attendance_status`, and what each value is called on screen.
 *
 * Shared rather than teacher-owned, for the same reason `lib/course-type.ts` is
 * shared: this is a mirror of a database enum, not either side's logic. A
 * teacher writes these four values and a student reads them, and the word next
 * to a student's lesson has to be the same word the teacher pressed. Two copies
 * of that mapping would be two chances for it to stop being true.
 *
 * Pure and not `server-only`, again like `lib/course-type.ts` — there is nothing
 * privileged here, only names.
 */

export type AttendanceStatus = Database["public"]["Enums"]["attendance_status"];

/**
 * All four values the enum carries, in the order they are offered to a teacher,
 * most to least common.
 *
 * All four, because the difference between them is load-bearing rather than
 * decorative: `v_member_session_attendance` counts `present` and `late` in the
 * numerator, `absent` in the denominator only, and drops an `excused` session
 * from both. Offering only two would make the one status that can legitimately
 * excuse a student from the denominator unreachable from the application.
 */
export const ATTENDANCE_STATUSES = [
  "present",
  "late",
  "absent",
  "excused",
] as const satisfies readonly AttendanceStatus[];

/** What each status is called on screen, on both sides of the application. */
export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  present: "Có mặt",
  late: "Đi muộn",
  absent: "Vắng mặt",
  excused: "Có phép",
};

/**
 * Whether a submitted value is one of the enum's four.
 *
 * The allow-list, not a cast. Postgres would reject anything else with
 * `22P02 invalid input value for enum`, which is a database error standing in
 * for what is really a malformed request, and one whose text should not reach a
 * user. Rejecting it here keeps the failure in the application's own vocabulary.
 */
export function isAttendanceStatus(value: string): value is AttendanceStatus {
  return (ATTENDANCE_STATUSES as readonly string[]).includes(value);
}

/**
 * Whether attendance may be recorded at a session that starts at `startsAt`.
 *
 * A teacher marks a register during or after a lesson, never before one: a mark
 * made in advance is a guess about a student who has not arrived, and it is
 * indistinguishable in `session_attendance` from an observation. So the sheet
 * opens at the moment the lesson opens, and not a minute earlier.
 *
 * `startsAt` is `class_sessions.starts_at` — a `timestamptz`, and therefore an
 * *instant*. Comparing two instants needs no timezone at all, which is why
 * nothing here consults `classes.timezone`: 19:30 in Ho Chi Minh City and the
 * same moment read in UTC are the same point on the timeline, and `Date.parse`
 * of an offset-bearing ISO string is that point. The class's zone is needed
 * only to *say* when the lesson starts, and that happens at the call sites that
 * print it. This is also why the rule is safe to evaluate in a browser: `now`
 * there is `Date.now()`, an instant, never a wall clock.
 *
 * The comparison is `>=`, so the lesson's own start minute is open. That is the
 * boundary the milestone names: at 19:29 the sheet is shut, at 19:30 it is not.
 *
 * Shared, and deliberately the only copy. The page decides what to draw with it
 * and `recordAttendance` decides whether to write with it; if those two rules
 * were written twice they could disagree, and the one that matters is the
 * server's. The page's use of it is a courtesy — the guard in the action is the
 * enforcement, because a Server Function is a POST endpoint and the absence of
 * a form is not a check.
 *
 * An unparseable instant fails *closed*. `starts_at` is NOT NULL and every
 * value in the column was written through `instantOf`, so this cannot be
 * reached by any row this application created; if it ever is, refusing to write
 * is the safe half of the mistake, and the refusal is visible on screen rather
 * than silent.
 */
export function isAttendanceOpen(
  startsAt: string,
  now: number = Date.now(),
): boolean {
  const opensAt = Date.parse(startsAt);

  if (Number.isNaN(opensAt)) {
    console.error("[attendance] unparseable session start", { startsAt });
    return false;
  }

  return now >= opensAt;
}
