import "server-only";

import type { Database } from "@/lib/database.types";
import type { createClient } from "@/lib/supabase/server";

/**
 * The homework a teaching session has set, read from the teacher's side.
 *
 * WHY THIS IS NOT A NEW SCHEMA. `homework_assignments` has carried a nullable
 * `session_id` since the foundation commit, tied to its class by the composite
 * key `(session_id, class_id) references class_sessions (id, class_id)` — so
 * the relationship the session workspace needs already exists, already refuses
 * a session belonging to another class, and already detaches rather than
 * cascades when a session is deleted. `homework_submissions` hangs one row per
 * member off each assignment with the same composite discipline.
 * `homework_assignments_teacher_all` scopes both to `app.my_class_ids()`, and
 * `20260828001400_grants.sql` grants the teacher select/insert/update/delete on
 * each. Nothing had to be added; only read and written.
 *
 * WHAT WAS MISSING WAS THE TEACHER'S HALF OF THE UI. `lib/student.ts` has read
 * this pair since M26 from the student's side; there was no teacher-side loader
 * and no way for a teacher to set homework at all. That is what this adds, and
 * it is a second reader of the same tables rather than a parallel system.
 *
 * A NOTE ON THE STALE COMMENT THIS REPLACES. `app/teacher/[classId]/page.tsx`
 * says of the roster table that "EduTrack has no homework: there is no table,
 * no view and no number". The first clause was never true — the tables shipped
 * with the database — and the roster column it justifies is still not built
 * here, because a per-student homework percentage is exactly the derived metric
 * this application keeps declining to invent. The comment is corrected where it
 * sits; the column stays absent.
 */

export type HomeworkStatus = Database["public"]["Enums"]["homework_status"];
export type Skill = Database["public"]["Enums"]["skill"];

/**
 * One assignment set for this session, with its submissions tallied.
 *
 * The tally is a count of real rows per status, not a percentage: four states
 * exist (`assigned | submitted | graded | missed`) and collapsing them into one
 * number would throw away the distinction between a student who has not started
 * and one who was marked as having missed it.
 */
export type SessionHomework = {
  assignmentId: string;
  title: string;
  description: string | null;
  skill: Skill;
  assignedOn: string;
  dueDate: string | null;
  maxScore: number;
  /** How many `homework_submissions` rows sit at each status. */
  counts: Record<HomeworkStatus, number>;
  /** Rows in total, which is how many students the assignment reached. */
  total: number;
};

function logDbError(
  operation: string,
  error: { code?: string; message?: string },
): void {
  console.error("[homework] " + operation + " failed", {
    code: error.code,
    message: error.message,
  });
}

const EMPTY_COUNTS = (): Record<HomeworkStatus, number> => ({
  assigned: 0,
  submitted: 0,
  graded: 0,
  missed: 0,
});

/**
 * Every assignment attached to one session of one class.
 *
 * Both `session_id` and `class_id` are in the WHERE clause even though the
 * composite foreign key already guarantees they agree. The redundancy is the
 * same defence-in-depth the rest of this codebase applies: the filter is what
 * the database is asked for, the constraint is what the database promises, and
 * a query that relies only on the promise is one schema change away from being
 * wrong. `homework_assignments_teacher_all` is the third layer and the one that
 * cannot be bypassed from here at all.
 *
 * The submissions come back embedded rather than as a second statement, so a
 * session with twenty assignments still costs one round trip.
 *
 * `null` means the query failed. `[]` means no homework has been set for this
 * session, which the page is then entitled to say.
 */
export async function loadSessionHomework(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string,
  sessionId: string,
): Promise<SessionHomework[] | null> {
  const { data, error } = await supabase
    .from("homework_assignments")
    .select(
      "id, title, description, skill, assigned_on, due_date, max_score, homework_submissions(status)",
    )
    .eq("class_id", classId)
    .eq("session_id", sessionId)
    .order("assigned_on", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    logDbError("homework_assignments.select", error);
    return null;
  }

  return (data ?? []).map((row) => {
    const counts = EMPTY_COUNTS();
    const submissions = row.homework_submissions ?? [];

    for (const submission of submissions) {
      counts[submission.status] += 1;
    }

    return {
      assignmentId: row.id,
      title: row.title,
      description: row.description,
      skill: row.skill,
      assignedOn: row.assigned_on,
      dueDate: row.due_date,
      maxScore: Number(row.max_score),
      counts,
      total: submissions.length,
    };
  });
}
