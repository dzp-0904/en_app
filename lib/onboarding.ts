import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { normaliseTeachingType, type OfferedCourseType } from "@/lib/course-type";
import { loadStudentClasses, type StudentContext } from "@/lib/student";
import { loadTeacherClassList, type TeacherClassFields } from "@/lib/teacher";

/**
 * Signed-in user classification, plus onboarding access control and progress —
 * all derived from the database.
 *
 * `loadUserState` is the one place that answers "who is this request", so `/`,
 * `/join/[code]`, `/onboarding/*` and `/student` cannot disagree about it. The
 * student half of that answer is loaded by `lib/student.ts`; everything below
 * the union is the teacher half.
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
  /**
   * Whether a second active class exists.
   *
   * The onboarding wizard was written when a teacher had exactly one class, so
   * its last step talks about "the" class and means `currentClass` — the newest
   * one. Once a teacher has several, that step cannot know which they meant, and
   * this is the flag that lets it say so instead of guessing. See
   * `requireFirstClass`.
   */
  hasMultipleClasses: boolean;
  /**
   * Every active class the teacher owns, newest first.
   *
   * Carried on the context because classifying the caller has to read this
   * table anyway — the wizard needs to know whether a class exists at all — and
   * `loadTeacherClassList` then re-issued the identical query one round trip
   * later on every teacher page. A page that needs the list takes it from here;
   * `currentClass` and `hasMultipleClasses` are the first entry and the length,
   * kept as named fields because onboarding reads them and should not have to
   * know that a list is what they come from.
   */
  classes: TeacherClassFields[];
};

/**
 * Who is asking.
 *
 * `app_role` is `('teacher', 'student')`, and this union now says so. It
 * previously stopped at "teacher or not", which meant a student — the other
 * half of the product — was classified by what they are not, and shared an arm
 * with genuine failures. `/` could then only offer them a teacher's page or a
 * shrug, so a student who had just joined a class was told to go and join one.
 *
 * `not-teacher` survives as what it should always have been: the arm for an
 * account that cannot currently be placed. A deactivated profile, an unreadable
 * one, or a role this build does not know about. It is not a student.
 *
 * Every signed-in variant carries the email: `/` names the account it is signed
 * in as, and it is the only identifier left when the profile read failed.
 */
export type UserState =
  | { kind: "anonymous" }
  | { kind: "not-teacher"; userId: string; email: string | null }
  | { kind: "teacher"; teacher: TeacherContext }
  | { kind: "student"; student: StudentContext };

/**
 * Classifies the caller without redirecting.
 *
 * `getUser()` is still called on every request and still decides the answer: it
 * asks the Auth server directly, so a session revoked server-side is caught
 * here, and `role` is read from the profile row rather than from a token that
 * predates a change to it. What changed in M24 is only *when* it runs. It used
 * to be awaited alone, ahead of everything, and measured **~150 ms** against
 * this hosted project — twice a PostgREST round trip (~80 ms) and the single
 * most expensive hop in the application. Sitting at the head of the chain it
 * delayed reads that did not depend on its answer.
 *
 * So the subject id now comes from `getClaims()` first, which verifies the JWT
 * locally via WebCrypto against a cached JWKS and costs no round trip, and the
 * three reads are issued together. `getUser()` is one of them, and nothing is
 * returned until it has answered:
 *
 *   - claims absent or unverifiable  -> anonymous, and no query is issued at all
 *   - claims valid but `getUser()` says no -> anonymous, and every row already
 *     fetched is discarded unread
 *
 * That is the same decision as before, taken on the same evidence, one round
 * trip earlier. It cannot widen what a caller may see: the reads carry the very
 * token being checked, so RLS scopes them to that subject's own rows whatever
 * this function does with `sub`, and a forged id in the `.eq()` would filter to
 * nothing rather than to somebody else. Supabase's own guidance treats
 * `getClaims()` as a sound way to establish identity for exactly this reason;
 * keeping `getUser()` alongside it is what preserves the revocation check the
 * previous ordering bought.
 *
 * A profile that cannot be read at all reports `not-teacher`. Failing closed is
 * right for an access decision, and the RLS policies would refuse the writes
 * anyway.
 *
 * Memoised for the duration of one request with React's `cache`. The shell
 * layout and the page inside it both have to ask who the caller is — the layout
 * to name them in the sidebar, the page to decide whether to serve them — and
 * without this every authenticated page would make two `auth.getUser()` round
 * trips and two profile reads. The scope is a single request, so the answer
 * cannot go stale inside it, and nothing here writes.
 */
export const loadUserState = cache(readUserState);

async function readUserState(): Promise<UserState> {
  const supabase = await createClient();

  // Local: the JWT is verified with WebCrypto against a cached JWKS, and a
  // token close to expiry is refreshed first. No Auth-server round trip. All
  // this is used for is the subject id, so the reads below can be issued now
  // instead of after `getUser()` returns — see this function's own comment.
  const { data: verified } = await supabase.auth.getClaims();
  const subject = verified?.claims.sub;

  // No token, or one that does not verify. Nothing is read at all.
  if (!subject) return { kind: "anonymous" };

  // All three at once. The two reads do not consult `getUser()`'s answer, and
  // the profile read does not consult the class read, so the only thing
  // sequencing them ever bought was ~230 ms of waiting per authenticated
  // request.
  //
  // The class read is speculative — it is a teacher's question and the role is
  // in a reply that has not arrived yet — so a student pays for one extra
  // statement. It is `where teacher_id = <their own id>`, which is RLS-scoped,
  // matches nothing, and runs concurrently, so it costs them no wall-clock
  // time and cannot return anything they may not see.
  //
  // It is `loadTeacherClassList` itself rather than the hand-written
  // `select id, name … limit(2)` this used to be. That probe existed only to
  // answer "is there a class, and is there more than one", and then
  // `loadTeacherClassList` issued the identical query — same table, same
  // `eq`/`is`/`order`, wider projection — one round trip later on every teacher
  // page. Reading the rows once, here, costs less than reading two of them and
  // then all of them, and composing the loader rather than restating its query
  // is what keeps the two projections from drifting apart.
  const [
    {
      data: { user },
    },
    { data: profile, error },
    classes,
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("profiles")
      .select("role, full_name, teaching_type, deactivated_at")
      .eq("id", subject)
      .maybeSingle(),
    loadTeacherClassList(supabase, subject),
  ]);

  // The Auth server has the final say, exactly as before. A session revoked
  // since the token was minted lands here, and everything read above is
  // discarded unread.
  if (!user) return { kind: "anonymous" };

  const unplaceable: UserState = {
    kind: "not-teacher",
    userId: user.id,
    email: user.email ?? null,
  };

  if (error) {
    console.error("[onboarding] failed to load profile", {
      code: error.code,
      message: error.message,
    });
    return unplaceable;
  }

  if (!profile) return unplaceable;

  // Checked before the role split, not inside the teacher branch, because
  // `app.is_teacher()` checks it too: a deactivated teacher's writes are
  // refused by every policy, so sending them into the wizard would only
  // produce failures further in. Extending the same rule to a deactivated
  // student is the conservative reading — an account that has been switched
  // off should not be handed a signed-in destination of any kind.
  if (profile.deactivated_at !== null) return unplaceable;

  if (profile.role === "student") {
    return {
      kind: "student",
      student: {
        userId: user.id,
        email: user.email ?? null,
        fullName: profile.full_name,
        classes: await loadStudentClasses(supabase, user.id),
      },
    };
  }

  // Unreachable while app_role is ('teacher', 'student') — and deliberately
  // kept, so that adding a third role fails closed here rather than falling
  // through into the teacher branch.
  if (profile.role !== "teacher") return unplaceable;

  // `loadTeacherClassList` has already logged the reason. A teacher whose class
  // list could not be read cannot be placed: every teacher page is built on it,
  // and `[]` here would mean "you have no classes", which is a different and
  // much worse claim than "we could not tell".
  if (classes === null) return unplaceable;

  return {
    kind: "teacher",
    teacher: {
      userId: user.id,
      email: user.email ?? null,
      fullName: profile.full_name,
      teachingType: normaliseTeachingType(profile.teaching_type),
      currentClass: classes[0]
        ? { id: classes[0].classId, name: classes[0].className }
        : null,
      hasMultipleClasses: classes.length > 1,
      classes,
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
  const state = await loadUserState();

  if (state.kind === "anonymous") {
    redirect("/auth/login");
  }

  // `/` is where a student or an unplaceable account gets sorted out; it will
  // move a student on to `/student` rather than bounce them back here.
  if (state.kind !== "teacher") {
    redirect("/");
  }

  return state.teacher;
}

export const ONBOARDING_STEPS = [
  { href: "/onboarding/name", label: "Tên của bạn" },
  { href: "/onboarding/teaching-type", label: "Nội dung giảng dạy" },
  { href: "/onboarding/class", label: "Tạo lớp học đầu tiên" },
  { href: "/onboarding/invite", label: "Mời học viên" },
] as const;

export type OnboardingStepIndex = 0 | 1 | 2 | 3;

/**
 * Where a teacher should land when they open `/onboarding`.
 *
 * Only the two persisted signals are consulted, so this is stable across
 * devices and sessions.
 *
 * The last line used to return `/onboarding/invite`, under a condition
 * character-for-character identical to `isOnboardingComplete`'s: a teacher who
 * had finished setting up was sent back into the wizard's final step to do
 * everyday work, and always into their most recent class, because that is the
 * only one onboarding knows about. `/` had already stopped doing this; this was
 * the door left open. A teacher with a class is done, and `/teacher` is where
 * they choose which class they meant.
 */
export function resumeHref(teacher: TeacherContext): string {
  if (teacher.teachingType === null) return "/onboarding/name";
  if (teacher.currentClass === null) return "/onboarding/class";
  return "/teacher";
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

/**
 * Step 4 requires the class from step 3 — and, transitively, step 2.
 *
 * It also requires that class to be the teacher's *only* one, which is the
 * whole difference between the wizard's last step and class management. Step 4
 * has no `[classId]` segment: it says "Class created!" about `currentClass`,
 * the newest row, because when it was written that was the only row there could
 * be. A teacher with several classes asking for this URL is asking about a
 * class this page cannot name, so they go to the list and pick one — where
 * `/teacher/[classId]` offers the same invitation link and the same invite-by-
 * email form, for the class they actually chose.
 *
 * This is a navigation guard, not an authorisation one. Nothing here decides
 * what may be read: `currentClass` was loaded under `classes_teacher_all` for
 * the authenticated user, so it is already the caller's own class, and the
 * redirect only decides which of two pages is the right one to show it on.
 */
export function requireFirstClass(teacher: TeacherContext): OnboardingClass {
  requireTeachingType(teacher);

  if (teacher.currentClass === null) {
    redirect("/onboarding/class");
  }

  if (teacher.hasMultipleClasses) {
    redirect("/teacher");
  }

  return teacher.currentClass;
}

/** True once the class step has produced a row — the end of required setup. */
export function isOnboardingComplete(teacher: TeacherContext): boolean {
  return teacher.currentClass !== null;
}
