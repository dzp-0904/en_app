import "server-only";

import type { Performance, Skill } from "@/lib/lesson-log";
import type { createClient } from "@/lib/supabase/server";
import type { TeacherClass } from "@/lib/teacher";

/**
 * The teacher's lesson notes, across every class rather than one session.
 *
 * `lib/teacher.ts` already reads `lesson_logs` — `loadSessionLessonNotes`, one
 * lesson at a time, which is what the session page needs. The Figma's Lesson
 * Logs screen is the other view of the same table: a reverse-chronological feed
 * of everything written, filterable, with the mistake tags and the note itself
 * on each card. Nothing new is stored for it and nothing is derived; this is
 * the same rows read with a different WHERE clause.
 *
 * `mistakes` is `text[] not null default '{}'` and the migration's own comment
 * says the labels are "copied by value, not FKs" — so an empty array is a real
 * answer (no tags on this note) and is rendered as no chips rather than as a
 * gap. `mistake_tags` is the vocabulary a teacher picks from when writing one;
 * it is not consulted here, because a note keeps the words it was written with
 * even if the tag is later renamed.
 *
 * FILTERS COME OFF THE URL AND ARE VALIDATED. `classId` is checked against the
 * teacher's own class list before it reaches the query, so a foreign uuid
 * narrows to nothing rather than being asked about; `skill` is checked against
 * `public.skill`. Both are also redundant against `lesson_logs_teacher_all`,
 * which admits only `app.my_class_ids()` — the filter agrees with the policy
 * rather than standing in for it.
 *
 * `null` means the query failed, `[]` means nothing has been written yet.
 */

export type TeacherLessonLog = {
  logId: string;
  classId: string;
  className: string;
  membershipId: string;
  studentName: string | null;
  /** `lesson_logs.lesson_date` — a bare `date`, already on the class's clock. */
  lessonDate: string;
  skill: Skill;
  performance: Performance;
  topic: string;
  mistakes: string[];
  note: string | null;
  createdAt: string;
};

/**
 * How many notes one page shows.
 *
 * The Figma's list is unbounded because its data is a five-item array. A real
 * teacher accumulates one note per student per lesson, so this is capped and
 * the page says when it is showing a capped list. Paging is not built: the
 * milestone's scope is the screen, and a "load more" control would be a new
 * interaction with no Figma counterpart.
 */
export const LESSON_LOG_PAGE_SIZE = 60;

const COLUMNS =
  "id, class_id, class_member_id, lesson_date, skill, performance, topic, mistakes, note, created_at, class_members!lesson_logs_member_fk(invited_name, profiles!class_members_student_id_fkey(full_name))";

function logDbError(
  operation: string,
  error: { code?: string; message?: string },
): void {
  console.error("[lesson-logs] " + operation + " failed", {
    code: error.code,
    message: error.message,
  });
}

export async function loadTeacherLessonLogs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classes: TeacherClass[],
  filters: { classId?: string | null; skill?: Skill | null },
): Promise<TeacherLessonLog[] | null> {
  if (classes.length === 0) return [];

  const names = new Map(classes.map((entry) => [entry.classId, entry.className]));

  // A class id that is not the teacher's own is not asked about at all. It
  // could not have matched anything — the policy sees to that — but narrowing
  // to nothing here keeps the query honest about what it is looking for.
  const scope =
    filters.classId && names.has(filters.classId)
      ? [filters.classId]
      : Array.from(names.keys());

  let query = supabase
    .from("lesson_logs")
    .select(COLUMNS)
    .in("class_id", scope)
    .order("lesson_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(LESSON_LOG_PAGE_SIZE);

  if (filters.skill) query = query.eq("skill", filters.skill);

  const { data: logs, error } = await query;

  if (error) {
    logDbError("lesson_logs.select", error);
    return null;
  }

  return (logs ?? []).map((log) => ({
    logId: log.id,
    classId: log.class_id,
    className: names.get(log.class_id) ?? "",
    membershipId: log.class_member_id,
    // The profile wins over the name the teacher typed, as on the roster.
    studentName:
      log.class_members?.profiles?.full_name ??
      log.class_members?.invited_name ??
      null,
    lessonDate: log.lesson_date,
    skill: log.skill,
    performance: log.performance,
    topic: log.topic,
    mistakes: log.mistakes ?? [],
    note: log.note,
    createdAt: log.created_at,
  }));
}
