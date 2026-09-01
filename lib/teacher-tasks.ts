import "server-only";

import type { Database } from "@/lib/database.types";
import type { createClient } from "@/lib/supabase/server";
import { zonedCalendarDate } from "@/lib/time";

/**
 * The teacher's own to-do list — the Dashboard's To-do panel.
 *
 * ## Why this is a new table, when almost nothing else in this project was
 *
 * The M32 audit looked for somewhere existing to put a teacher's task, because
 * three milestones running (M22, M27, M30) the brief's premise about missing
 * data turned out to be answered by the schema. Not this time. Nothing in the
 * sixteen migrations holds free text a teacher wrote for themself, with a
 * priority they chose and a completion state they control:
 * `homework_assignments.due_date` is a *student's* deadline and is visible to
 * students; `tuition_records.reminder_sent_at` is a timestamp on an invoice;
 * `class_members.invite_reminder_count` is a counter. Overloading one of them
 * would make an existing column mean two things depending on who wrote it.
 *
 * The Figma's own To-do is `useState` over five hardcoded strings, so there was
 * nothing to reuse on that side either.
 *
 * ## That migration is NOT APPLIED
 *
 * `supabase/migrations/20260901000200_teacher_tasks.sql` was written and
 * deliberately left unexecuted, at the user's instruction and under the same
 * standing rule that keeps `20260901000100_class_materials.sql` unapplied.
 * Until a human runs it, every query below fails and returns `null`, and the
 * panel renders the same "we could not load this" alert every other failed read
 * renders. Nothing here creates the table on demand, and the panel does not
 * pretend to work: an empty list and a failed read are different states and
 * this module keeps them different.
 *
 * ## Where the clock comes from
 *
 * A due date is a calendar square, so "Quá hạn / Hôm nay / Ngày mai" needs a
 * zone to be read on. `profiles` has no timezone column, so the answer is the
 * one `lib/calendar.ts` already settled for the calendar's own "today":
 * `calendarZone(classes)` — the first class's zone, falling back to the
 * schema's own default. `taskClock` below turns that zone into the one instant
 * the whole panel is rendered from, through `lib/time.ts`; nothing here calls
 * `toISOString().slice(0, 10)`, which is the conversion §7 forbids.
 */

export type TaskPriority = Database["public"]["Enums"]["task_priority"];

/**
 * Strongest first — the Figma's High / Medium / Low, and the order the enum is
 * declared in, so a Postgres `order by priority` and this array agree.
 */
export const TASK_PRIORITIES: readonly TaskPriority[] = [
  "high",
  "medium",
  "low",
] as const;

/** §3's convention: the label map lives beside its enum. */
export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: "Cao",
  medium: "Trung bình",
  low: "Thấp",
};

/** `teacher_tasks_title_length` allows 1..300 after trimming. */
export const TASK_TITLE_MAX = 300;

/**
 * How long a ticked task stays on the panel before it stops being listed.
 *
 * The Figma hides a completed task 24 hours after it was ticked. Here that is a
 * **filter**, not a delete and not a scheduled job: the row keeps existing, it
 * simply stops matching the query. A cron would need infrastructure this
 * project does not have, and a delete would destroy a record the teacher might
 * still want — and neither is necessary to make the panel behave as designed.
 */
export const TASK_CLEAR_MS = 24 * 60 * 60 * 1000;

export type TeacherTask = {
  taskId: string;
  title: string;
  priority: TaskPriority;
  /** `YYYY-MM-DD`, or null — a task without a deadline is valid. */
  dueDate: string | null;
  /** The instant it was ticked, or null while outstanding. */
  completedAt: string | null;
};

/**
 * The one clock reading the To-do panel is rendered from.
 *
 * Both halves come from a single instant — the calendar square a deadline is
 * compared against, and the millisecond the "hides in N hours" note counts down
 * from — which is what stops the two from disagreeing across a midnight
 * boundary. The same shape, and the same reasoning, as `nowIn` in
 * `lib/calendar.ts`.
 *
 * It lives here rather than in the page because reading a clock during render
 * is exactly what a component must not do: this is the module boundary the rest
 * of the codebase already puts that read behind.
 */
export function taskClock(zone: string): { today: string; now: number } {
  const instant = new Date();
  return {
    today: zonedCalendarDate(zone, instant.toISOString()),
    now: instant.getTime(),
  };
}

/** Narrows a submitted string to the enum, so the form cannot widen it. */
export function isTaskPriority(value: string): value is TaskPriority {
  return (TASK_PRIORITIES as readonly string[]).includes(value);
}

function logDbError(
  operation: string,
  error: { code?: string; message?: string },
): void {
  console.error(`[teacher-tasks] ${operation} failed`, {
    code: error.code,
    message: error.message,
  });
}

/**
 * The teacher's tasks, in the order the panel draws them.
 *
 * The whole sort is done in the database, because Postgres orders an enum by
 * its declaration order — `high < medium < low` — which is exactly the Figma's
 * `ORDER.indexOf` comparator without a second copy of it in TypeScript.
 * Outstanding tasks come first (`completed_at` is null), then recently ticked
 * ones oldest-first, so the row about to leave the panel is the one nearest the
 * "clears in" note.
 *
 * The 24-hour window is expressed as a filter rather than applied after the
 * fact so that a teacher with a long history of finished tasks does not pay to
 * fetch them. `or()` is one statement, not two round trips.
 *
 * `teacher_id` is in the WHERE clause even though `teacher_tasks_owner_all`
 * already scopes the read to this teacher — the same defence-in-depth the rest
 * of this codebase applies, with the policy as the layer that cannot be talked
 * out of its answer.
 *
 * `null` means the query failed, which today includes "the table does not exist
 * yet". `[]` means the teacher has no tasks, which the panel may then say.
 */
export async function loadTeacherTasks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  teacherId: string,
): Promise<TeacherTask[] | null> {
  const cutoff = new Date(Date.now() - TASK_CLEAR_MS).toISOString();

  const { data, error } = await supabase
    .from("teacher_tasks")
    .select("id, title, priority, due_date, completed_at")
    .eq("teacher_id", teacherId)
    .or(`completed_at.is.null,completed_at.gte.${cutoff}`)
    .order("completed_at", { ascending: true, nullsFirst: true })
    .order("priority", { ascending: true })
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (error) {
    logDbError("teacher_tasks.select", error);
    return null;
  }

  return (data ?? []).map((row) => ({
    taskId: row.id,
    title: row.title,
    priority: row.priority,
    dueDate: row.due_date,
    completedAt: row.completed_at,
  }));
}

/**
 * Whole days from one calendar square to another, both `YYYY-MM-DD`.
 *
 * `Date.UTC` on the three parsed parts, so both ends are midnight in the same
 * fictional zone and the subtraction is exact whatever the server's own clock
 * is set to. No `Date` is constructed from a string, and no instant is sliced
 * back into a date — the two mistakes `lib/time.ts` exists to prevent.
 */
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const ms = Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd);
  return Math.round(ms / 86_400_000);
}

/**
 * How a deadline reads, and whether it is pressing.
 *
 * The Figma's `fmtDeadline` in Vietnamese, with one difference that matters:
 * it measures from `Date.now()` in the browser's zone, and this measures from a
 * date the page resolved on the class's zone (§7). A teacher in Vietnam looking
 * at a deadline near midnight should not be told "Hôm nay" or "Ngày mai"
 * depending on where the server is running.
 *
 * `urgent` is the design's own flag — overdue, today or tomorrow — and the
 * panel is what decides to stop honouring it once a task is done.
 */
export function deadlineState(
  dueDate: string,
  today: string,
): { label: string; urgent: boolean } {
  const days = daysBetween(today, dueDate);

  if (days < 0) return { label: "Quá hạn", urgent: true };
  if (days === 0) return { label: "Hôm nay", urgent: true };
  if (days === 1) return { label: "Ngày mai", urgent: true };

  const [, month, day] = dueDate.split("-");
  return { label: `${day}/${month}`, urgent: false };
}

/**
 * Whole hours a ticked task has left on the panel, 1..24.
 *
 * Rounded up, so a task with forty minutes to go says "1 giờ" rather than "0
 * giờ" — a countdown that reaches zero while the row is still visible is worse
 * than one that is generous by under an hour. Clamped at both ends because the
 * query has already excluded anything older than the window, and a clock skew
 * must not produce a negative.
 */
export function clearsInHours(completedAt: string, now: number): number {
  const remaining = TASK_CLEAR_MS - (now - Date.parse(completedAt));
  return Math.min(24, Math.max(1, Math.ceil(remaining / 3_600_000)));
}
