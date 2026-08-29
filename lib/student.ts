import "server-only";

import type { AttendanceStatus } from "@/lib/attendance";
import type { CourseType } from "@/lib/course-type";
import type { createClient } from "@/lib/supabase/server";

/**
 * A student's own enrolments.
 *
 * The counterpart to the teacher half of `lib/onboarding.ts`: where that asks
 * "has this teacher finished setting up", this asks "which classes is this
 * student actually in". Both feed the same classification in `loadUserState`.
 *
 * Nothing here is a security boundary. Every row this module can reach is
 * already fixed by RLS — `class_members_student_select` is `student_id =
 * auth.uid()`, and the two embedded resources are reachable only through
 * `classes_student_select` and `profiles_select`, which resolve through
 * `app.my_student_class_ids()` and `app.my_teacher_ids()` respectively. Both
 * helpers already restrict themselves to `join_status = 'joined'` and
 * `removed_at is null`, so the filters below agree with the policies rather
 * than adding to them: a student cannot see another student's membership, a
 * classmate's profile, or a class they have left, whatever this file asks for.
 */

export type StudentClass = {
  /** class_members.id — the per-class record every child table hangs off. */
  membershipId: string;
  classId: string;
  className: string;
  /** Null only if the teacher's profile became unreadable mid-flight. */
  teacherName: string | null;
  joinedAt: string | null;
};

export type StudentContext = {
  userId: string;
  email: string | null;
  fullName: string;
  /**
   * Every active enrolment, newest first — NOT capped at one. `class_members`
   * is keyed `(class_id, student_id)`, so one student legitimately holds many
   * rows across many classes and the UI has to be able to show all of them.
   *
   * `null` means the query failed, which is deliberately not the same value as
   * `[]`. Collapsing the two would tell a student with three classes that they
   * have none, and invite them to wait for an invitation they already accepted.
   */
  classes: StudentClass[] | null;
};

/**
 * Loads the student's active memberships.
 *
 * `student_id` is passed rather than trusted from anywhere client-side: it comes
 * from `getUser()`, and RLS pins it to `auth.uid()` regardless. The filter is
 * belt-and-braces so the intent is readable at the call site, not because the
 * policy needs help.
 *
 * `!inner` on both hops is what makes a class whose row RLS hides drop the
 * membership too, instead of surfacing a half-populated entry with no name.
 */
export async function loadStudentClasses(
  supabase: Awaited<ReturnType<typeof createClient>>,
  studentId: string,
): Promise<StudentClass[] | null> {
  const { data, error } = await supabase
    .from("class_members")
    .select("id, joined_at, classes!inner(id, name, profiles!inner(full_name))")
    .eq("student_id", studentId)
    .eq("join_status", "joined")
    .is("removed_at", null)
    .order("joined_at", { ascending: false });

  if (error) {
    console.error("[student] failed to load memberships", {
      code: error.code,
      message: error.message,
    });
    return null;
  }

  return (data ?? []).map((row) => ({
    membershipId: row.id,
    classId: row.classes.id,
    className: row.classes.name,
    teacherName: row.classes.profiles?.full_name ?? null,
    joinedAt: row.joined_at,
  }));
}

/**
 * One class, as the student who is in it sees it.
 *
 * Everything `StudentClass` carries, plus the descriptive columns `/student`
 * has no room for. Deliberately only columns that exist on `public.classes` —
 * there is no lesson, homework, score or attendance data here because none of
 * it is being read yet, and a field invented now would have to be unpicked
 * later.
 *
 * `courseTypeOther` is the free-text name for `course_type = 'other'`, which
 * `classes_course_type_other_required` guarantees is non-null in exactly that
 * case and null in every other. `LABELS` covers the three offered types; this
 * is what covers the fourth.
 */
export type StudentClassDetail = StudentClass & {
  courseType: CourseType;
  courseTypeOther: string | null;
  targetBand: number | null;
  /** `start_date` is NOT NULL; `end_date` is optional — an open-ended course. */
  startDate: string;
  endDate: string | null;
  scheduleNote: string | null;
  /**
   * `classes.timezone` — the clock every session of this class is read on.
   *
   * Carried here so the lesson list can hand it to `lib/time.ts` unchanged.
   * The alternative is a second lookup, or worse a second idea of what time it
   * is: a session is stored as an instant, and the only zone that turns it back
   * into the hour on the timetable is the class's own.
   */
  timezone: string;
};

/**
 * Why three arms and not `StudentClassDetail | null`.
 *
 * "You are not in this class" and "the database did not answer" are different
 * facts and the page owes the reader a different answer to each: a 404 for the
 * first, "try again" for the second. Collapsing them would tell a student whose
 * query timed out that their class does not exist, which is the same mistake
 * `StudentContext.classes` uses `null` to avoid.
 *
 * There is no `anonymous` arm: the caller has already classified the request
 * through `loadUserState`, and `studentId` below comes from that. Re-deriving
 * the identity here would be a second answer to a question the app answers in
 * one place.
 */
export type StudentClassResult =
  | { kind: "ok"; detail: StudentClassDetail }
  | { kind: "not-found" }
  | { kind: "error" };

/** `class_id` is a uuid column, so anything else cannot name a row. */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Loads one class the student belongs to.
 *
 * The membership check is not a step before the read — it *is* the read. The
 * query starts from `class_members` and reaches the class through `!inner`, so
 * a `classId` the student is not joined to matches no row and there is nothing
 * to leak: no name, no teacher, no evidence the class exists at all. Same
 * filters as `loadStudentClasses`, plus the id, and `student_id` is still the
 * value `getUser()` returned rather than anything off the URL.
 *
 * `maybeSingle` is safe because `class_members_class_student_key` is unique on
 * `(class_id, student_id) where student_id is not null`.
 *
 * The uuid guard is what keeps the error arm meaningful. Handing PostgREST
 * `/student/nonsense` would come back as `22P02 invalid input syntax for type
 * uuid` — a client mistake arriving in the shape of a server failure, which
 * would show a mistyped URL the "please refresh" banner instead of a 404.
 */
export async function loadStudentClass(
  supabase: Awaited<ReturnType<typeof createClient>>,
  studentId: string,
  classId: string,
): Promise<StudentClassResult> {
  if (!UUID.test(classId)) return { kind: "not-found" };

  const { data, error } = await supabase
    .from("class_members")
    .select(
      "id, joined_at, classes!inner(id, name, course_type, course_type_other, target_band, start_date, end_date, schedule_note, timezone, profiles!inner(full_name))",
    )
    .eq("student_id", studentId)
    .eq("class_id", classId)
    .eq("join_status", "joined")
    .is("removed_at", null)
    .maybeSingle();

  if (error) {
    console.error("[student] failed to load membership", {
      code: error.code,
      message: error.message,
    });
    return { kind: "error" };
  }

  if (!data) return { kind: "not-found" };

  return {
    kind: "ok",
    detail: {
      membershipId: data.id,
      classId: data.classes.id,
      className: data.classes.name,
      teacherName: data.classes.profiles?.full_name ?? null,
      joinedAt: data.joined_at,
      courseType: data.classes.course_type,
      courseTypeOther: data.classes.course_type_other,
      targetBand: data.classes.target_band,
      startDate: data.classes.start_date,
      endDate: data.classes.end_date,
      scheduleNote: data.classes.schedule_note,
      timezone: data.classes.timezone,
    },
  };
}

/**
 * One lesson of the student's class, with their own mark for it.
 *
 * `attendance` is null when no `session_attendance` row exists for this student
 * at this session, and that is a real state rather than a missing one: rows are
 * created only when a teacher records something. It is deliberately not read as
 * `absent` — the page says "Not recorded", and nothing here invents a row to
 * fill the gap.
 */
export type StudentLesson = {
  sessionId: string;
  startsAt: string;
  endsAt: string;
  title: string | null;
  status: "scheduled" | "completed" | "cancelled";
  attendance: AttendanceStatus | null;
};

/**
 * The class's lessons and this student's own attendance at them.
 *
 * ## Why not `v_member_session_attendance`
 *
 * It is the obvious candidate and it is the wrong grain for this screen. The
 * view answers "what should this student's attendance *rate* be built from",
 * and to do that it drops rows on purpose: cancelled sessions, sessions that
 * have not started, sessions before the member joined, and — decisively —
 * every session the student was marked `excused` for, which is excluded from
 * numerator and denominator alike. A student marked Excused would find the
 * lesson simply absent from their own list, and the milestone requires that
 * exact word to be shown. The view also carries neither `ends_at` nor `title`,
 * so it cannot render the line above the status either. It stays as it is, for
 * the rate calculations it was written for.
 *
 * ## What authorises this
 *
 * `membershipId` is `class_members.id` as returned by `loadStudentClass`, which
 * derived it from `getUser()` — it is never a value off the URL or a form, and
 * there is no argument here that a browser can choose except `classId`, which
 * selects rather than authorises. Underneath, the two policies say the same
 * thing again: `class_sessions_student_select` admits only
 * `app.my_student_class_ids()` (`join_status = 'joined'`, `removed_at is null`),
 * and `session_attendance_student_select` admits only `app.my_member_ids()` —
 * memberships whose `student_id` is `auth.uid()`. Another student's row is not
 * filtered out of this result; it never arrives in the process at all.
 *
 * Two queries, neither of them per lesson, so this is not an N+1. `null` means
 * a query failed and is deliberately not `[]`, which means the class has no
 * lessons yet.
 */
export async function loadStudentLessons(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string,
  membershipId: string,
): Promise<StudentLesson[] | null> {
  const { data: sessions, error: sessionError } = await supabase
    .from("class_sessions")
    .select("id, starts_at, ends_at, title, status")
    .eq("class_id", classId)
    // Chronological on the stored instant, which is what the
    // `(class_id, starts_at)` unique constraint's index already orders.
    .order("starts_at", { ascending: true });

  if (sessionError) {
    console.error("[student] failed to load lessons", {
      code: sessionError.code,
      message: sessionError.message,
    });
    return null;
  }

  if (!sessions || sessions.length === 0) return [];

  // Scoped to this membership in the WHERE clause, not in TypeScript. The
  // policy would refuse another student's rows regardless; asking only for
  // one's own is the query saying what it means.
  const { data: marks, error: markError } = await supabase
    .from("session_attendance")
    .select("session_id, status")
    .eq("class_id", classId)
    .eq("class_member_id", membershipId);

  if (markError) {
    console.error("[student] failed to load attendance", {
      code: markError.code,
      message: markError.message,
    });
    return null;
  }

  const recorded = new Map<string, AttendanceStatus>();
  for (const mark of marks ?? []) recorded.set(mark.session_id, mark.status);

  return sessions.map((session) => ({
    sessionId: session.id,
    startsAt: session.starts_at,
    endsAt: session.ends_at,
    title: session.title,
    status: session.status,
    // Absent from the map means unmarked, which is not the same as `absent`.
    attendance: recorded.get(session.id) ?? null,
  }));
}
