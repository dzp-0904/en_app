import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { normaliseTeachingType, type OfferedCourseType } from "@/lib/course-type";

/**
 * Onboarding access control and progress, both derived from the database.
 *
 * There is no `onboarding_completed` column and none is being added, so progress
 * is inferred from the rows that onboarding actually creates:
 *
 *   profiles.teaching_type   set by the teaching-type step
 *   classes                  a row exists once the class step succeeds
 *
 * `profiles.full_name` is deliberately NOT a progress signal. Every account has
 * one — `app.handle_new_user` falls back to the email local-part — so "has a
 * name" is true before onboarding starts and can never mean "answered the name
 * question". The name step therefore always renders, pre-filled with the stored
 * value, and a returning teacher confirms rather than retypes it.
 */

export type OnboardingClass = {
  id: string;
  name: string;
};

export type TeacherContext = {
  userId: string;
  /** From auth.users, so it is present even when the profile row is not. */
  email: string | null;
  fullName: string;
  teachingType: OfferedCourseType | null;
  /** The teacher's most recent active class, or null before the class step. */
  currentClass: OnboardingClass | null;
};

/**
 * Who is asking, from onboarding's point of view.
 *
 * Three outcomes rather than a nullable teacher, because `/` needs to tell a
 * signed-in student from a visitor and a nullable value cannot.
 *
 * Both signed-in variants carry the email: `/` names the account it is signed in
 * as, and it is the only identifier available when the profile read failed.
 */
export type TeacherState =
  | { kind: "anonymous" }
  | { kind: "not-teacher"; userId: string; email: string | null }
  | { kind: "teacher"; teacher: TeacherContext };

/**
 * Reads the caller's onboarding state without redirecting.
 *
 * `getUser()` rather than `getClaims()`: this gates writes, so it is worth the
 * round trip to the Auth server to be sure the session has not been revoked and
 * that `role` is read from the row rather than from a token that predates a
 * change to it.
 *
 * A profile that cannot be read at all reports `not-teacher`. Failing closed is
 * right for an access decision, and the RLS policies would refuse the writes
 * anyway.
 */
export async function loadTeacherState(): Promise<TeacherState> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { kind: "anonymous" };

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role, full_name, teaching_type, deactivated_at")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[onboarding] failed to load profile", {
      code: error.code,
      message: error.message,
    });
    return { kind: "not-teacher", userId: user.id, email: user.email ?? null };
  }

  // A student, a deactivated teacher, or an account with no readable profile
  // row has no business in the teacher wizard. `deactivated_at` is checked here
  // because `app.is_teacher()` checks it too — a deactivated teacher's writes
  // would be refused by every policy, so sending them into the wizard would
  // only produce failures further in.
  if (!profile || profile.role !== "teacher" || profile.deactivated_at !== null) {
    return { kind: "not-teacher", userId: user.id, email: user.email ?? null };
  }

  const { data: classes, error: classError } = await supabase
    .from("classes")
    .select("id, name")
    .eq("teacher_id", user.id)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (classError) {
    console.error("[onboarding] failed to load classes", {
      code: classError.code,
      message: classError.message,
    });
    return { kind: "not-teacher", userId: user.id, email: user.email ?? null };
  }

  return {
    kind: "teacher",
    teacher: {
      userId: user.id,
      email: user.email ?? null,
      fullName: profile.full_name,
      teachingType: normaliseTeachingType(profile.teaching_type),
      currentClass: classes?.[0] ?? null,
    },
  };
}

/**
 * Every onboarding route and every onboarding Server Action funnels through
 * here: signed in, then `role = 'teacher'` and not deactivated.
 *
 * This is for navigation, not security. The security boundary is the RLS
 * policies — `classes_teacher_all` requires `app.is_teacher()`, and
 * `profiles_teaching_type_teacher_only` refuses a teaching type on a student
 * row — so a student who reached these actions another way would still write
 * nothing.
 */
export async function requireTeacher(): Promise<TeacherContext> {
  const state = await loadTeacherState();

  if (state.kind === "anonymous") {
    redirect("/auth/login");
  }

  if (state.kind === "not-teacher") {
    redirect("/");
  }

  return state.teacher;
}

export const ONBOARDING_STEPS = [
  { href: "/onboarding/name", label: "Your name" },
  { href: "/onboarding/teaching-type", label: "Teaching type" },
  { href: "/onboarding/class", label: "Create first class" },
  { href: "/onboarding/invite", label: "Invite students" },
] as const;

export type OnboardingStepIndex = 0 | 1 | 2 | 3;

/**
 * Where a teacher should land when they open `/onboarding`.
 *
 * Only the two persisted signals are consulted, so this is stable across
 * devices and sessions.
 */
export function resumeHref(teacher: TeacherContext): string {
  if (teacher.teachingType === null) return "/onboarding/name";
  if (teacher.currentClass === null) return "/onboarding/class";
  return "/onboarding/invite";
}

/**
 * Prerequisite guards, so a later step cannot be reached by typing its URL.
 *
 * Steps 1 and 2 need none: every account has a name, and the teaching type is
 * the first thing onboarding actually records.
 *
 * Both return the value they checked for rather than `void`, which is what lets
 * the calling page use it without a non-null assertion — the redirect and the
 * narrowing stay in one place instead of being restated at each call site.
 */

/** Step 3 requires the teaching type from step 2. */
export function requireTeachingType(teacher: TeacherContext): OfferedCourseType {
  if (teacher.teachingType === null) {
    redirect("/onboarding/teaching-type");
  }

  return teacher.teachingType;
}

/** Step 4 requires the class from step 3 — and, transitively, step 2. */
export function requireClass(teacher: TeacherContext): OnboardingClass {
  requireTeachingType(teacher);

  if (teacher.currentClass === null) {
    redirect("/onboarding/class");
  }

  return teacher.currentClass;
}

/** True once the class step has produced a row — the end of required setup. */
export function isOnboardingComplete(teacher: TeacherContext): boolean {
  return teacher.currentClass !== null;
}
