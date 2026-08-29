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
  present: "Present",
  late: "Late",
  absent: "Absent",
  excused: "Excused",
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
