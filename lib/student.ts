import "server-only";

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
