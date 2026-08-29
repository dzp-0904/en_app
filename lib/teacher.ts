import "server-only";

import type { CourseType } from "@/lib/course-type";
import type { createClient } from "@/lib/supabase/server";

/**
 * A teacher's own classes and rosters.
 *
 * The counterpart to `lib/student.ts`, and deliberately its mirror image: the
 * same three-arm result, the same "null means the query failed, [] means there
 * is nothing" rule, the same refusal to accept an id from the URL as evidence
 * of anything.
 *
 * This is separate from `lib/onboarding.ts` on purpose. That module answers
 * "has this teacher finished setting up", and its `.limit(1)` class lookup is a
 * progress signal, not a class list — a teacher with three classes still has
 * one onboarding state. Everything here is about classes the teacher already
 * has, so mixing the two would make each harder to read and would tempt a
 * future caller into treating `currentClass` as "the" class.
 *
 * Nothing here is a security boundary. Every row is already fixed by RLS:
 * `classes_teacher_all` and `class_members_teacher_all` resolve through
 * `app.my_class_ids()`, which joins `profiles` and drops a deactivated
 * teacher's classes entirely, and `profiles_select` admits a student's row only
 * via `app.my_student_ids()` — the roster of a class the caller owns. The
 * `teacher_id` filter below agrees with those policies rather than adding to
 * them, so it is readable intent, not the control.
 */

/**
 * A class's own columns — everything `CLASS_COLUMNS` selects, and nothing that
 * has to be counted or joined for.
 *
 * Split out from `TeacherClass` because the edit form needs exactly this and
 * none of the rest: loading a roster and an invitation code to populate a text
 * input would be two queries spent on values the form never shows.
 */
export type TeacherClassFields = {
  classId: string;
  className: string;
  courseType: CourseType;
  /** The free-text name for `course_type = 'other'`; null for every other. */
  courseTypeOther: string | null;
  targetBand: number | null;
  /** `start_date` is NOT NULL; `end_date` is optional — an open-ended course. */
  startDate: string;
  endDate: string | null;
  scheduleNote: string | null;
};

export type TeacherClass = TeacherClassFields & {
  /** Members who have claimed their invitation and not been removed. */
  studentCount: number;
  /** Invitations sent but not yet claimed. */
  pendingCount: number;
};

/**
 * One line of the class roster.
 *
 * A `class_members` row identifies its person in one of two ways, and which one
 * depends on `join_status`: an `invited` row has only the address the teacher
 * typed, and a `joined` row has a real profile behind it. Rather than make
 * every caller re-derive that, the two shapes are flattened here into one
 * `name` and one `email`, with `status` saying which source they came from.
 *
 * `departed` rows are excluded upstream. That status clears `student_id`,
 * `invited_email` and `invited_name` together — the account was deleted — so
 * such a row can only ever render as a blank line.
 */
export type RosterEntry = {
  /** class_members.id — the per-class record every child table hangs off. */
  membershipId: string;
  status: "joined" | "invited";
  /** Profile name once claimed; the name the teacher typed while pending. */
  name: string | null;
  email: string | null;
  joinedAt: string | null;
  invitedAt: string | null;
  /** Stamped only on a confirmed SMTP send, so it never overstates delivery. */
  inviteEmailSentAt: string | null;
};

export type TeacherClassDetail = TeacherClass & {
  roster: RosterEntry[];
  /**
   * The class's live invitation code, or null when there is no usable one.
   *
   * Null covers both "no active code" and "the lookup failed", which is honest
   * because the teacher's situation is identical either way: there is no link
   * to hand out right now. The page's wording covers both cases, and the
   * failure is logged rather than swallowed.
   */
  inviteCode: string | null;
};

export type TeacherClassResult =
  | { kind: "ok"; detail: TeacherClassDetail }
  | { kind: "not-found" }
  | { kind: "error" };

export type TeacherClassFieldsResult =
  | { kind: "ok"; fields: TeacherClassFields }
  | { kind: "not-found" }
  | { kind: "error" };

/** `classes.id` is a uuid column, so anything else cannot name a row. */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a string could name a class at all.
 *
 * Exported so `updateClass` applies the same rule the loaders do. Without it a
 * mistyped id reaches PostgREST as `22P02 invalid input syntax for type uuid` —
 * a database error where the truth is simply that no such class exists.
 */
export function isClassId(value: string): boolean {
  return UUID.test(value);
}

/** The columns every class view needs, in one place so the two agree. */
const CLASS_COLUMNS =
  "id, name, course_type, course_type_other, target_band, start_date, end_date, schedule_note";

/** Roster statuses that describe a present person. See `RosterEntry`. */
const PRESENT: ("joined" | "invited")[] = ["joined", "invited"];

function logDbError(
  operation: string,
  error: { code?: string; message?: string },
): void {
  console.error(`[teacher] ${operation} failed`, {
    code: error.code,
    message: error.message,
  });
}

/**
 * Every class the teacher owns and has not archived, newest first.
 *
 * Not capped at one, unlike the lookup in `lib/onboarding.ts`. Nothing in the
 * schema limits a teacher to a single class — `classes` is keyed only by its
 * own id — so the list has to be able to show all of them.
 *
 * `null` means the query failed, which is deliberately not `[]`. Telling a
 * teacher with four classes that they have none would invite them to create a
 * fifth.
 */
export async function loadTeacherClasses(
  supabase: Awaited<ReturnType<typeof createClient>>,
  teacherId: string,
): Promise<TeacherClass[] | null> {
  const { data: classes, error } = await supabase
    .from("classes")
    .select(CLASS_COLUMNS)
    .eq("teacher_id", teacherId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    logDbError("classes.select", error);
    return null;
  }

  if (!classes || classes.length === 0) return [];

  // Counted in a second statement and grouped here rather than as embedded
  // aggregates: PostgREST cannot express two differently-filtered counts over
  // the same embedded relation in one request, and a single filtered count
  // would silently drop the pending total. Two plain queries stay legible and
  // stay typed.
  const { data: members, error: memberError } = await supabase
    .from("class_members")
    .select("class_id, join_status")
    .in(
      "class_id",
      classes.map((row) => row.id),
    )
    .in("join_status", PRESENT)
    .is("removed_at", null);

  if (memberError) {
    logDbError("class_members.count", memberError);
    return null;
  }

  const joined = new Map<string, number>();
  const pending = new Map<string, number>();

  for (const member of members ?? []) {
    const tally = member.join_status === "joined" ? joined : pending;
    tally.set(member.class_id, (tally.get(member.class_id) ?? 0) + 1);
  }

  return classes.map((row) => ({
    classId: row.id,
    className: row.name,
    courseType: row.course_type,
    courseTypeOther: row.course_type_other,
    targetBand: row.target_band,
    startDate: row.start_date,
    endDate: row.end_date,
    scheduleNote: row.schedule_note,
    studentCount: joined.get(row.id) ?? 0,
    pendingCount: pending.get(row.id) ?? 0,
  }));
}

/**
 * Loads one class the teacher owns — its own columns, nothing else.
 *
 * The narrow half of `loadTeacherClass`, and the half that carries the
 * authorisation: `teacher_id` is part of the WHERE clause, so a `classId`
 * belonging to another teacher matches no row and comes back `not-found`. There
 * is nothing to leak, because nothing was read — not the name, not the roster,
 * not the invitation code, not the fact that the class exists at all.
 *
 * `teacherId` is the value `getUser()` returned by way of `loadUserState`, never
 * anything off the URL or a form.
 *
 * The three arms stay distinct on purpose. A failed query is `error`, not
 * `not-found`: telling a teacher their class is gone when the database merely
 * stumbled is the worse of the two mistakes, and it is the one a two-arm result
 * would make.
 */
export async function loadEditableClass(
  supabase: Awaited<ReturnType<typeof createClient>>,
  teacherId: string,
  classId: string,
): Promise<TeacherClassFieldsResult> {
  // Before the round trip, so a mistyped link is a 404 rather than `22P02
  // invalid input syntax for type uuid` arriving in the shape of a server fault.
  if (!UUID.test(classId)) return { kind: "not-found" };

  const { data: found, error } = await supabase
    .from("classes")
    .select(CLASS_COLUMNS)
    .eq("id", classId)
    .eq("teacher_id", teacherId)
    .is("archived_at", null)
    .maybeSingle();

  if (error) {
    logDbError("classes.select(one)", error);
    return { kind: "error" };
  }

  if (!found) return { kind: "not-found" };

  return {
    kind: "ok",
    fields: {
      classId: found.id,
      className: found.name,
      courseType: found.course_type,
      courseTypeOther: found.course_type_other,
      targetBand: found.target_band,
      startDate: found.start_date,
      endDate: found.end_date,
      scheduleNote: found.schedule_note,
    },
  };
}

/**
 * Loads one class the teacher owns, with its roster.
 *
 * `loadEditableClass` does the ownership half, and its result is passed straight
 * through: a class belonging to someone else is `not-found` before the roster
 * query is ever issued, so a stranger's class leaks neither its members nor its
 * existence. Everything below runs only once that has returned `ok`.
 */
export async function loadTeacherClass(
  supabase: Awaited<ReturnType<typeof createClient>>,
  teacherId: string,
  classId: string,
): Promise<TeacherClassResult> {
  const owned = await loadEditableClass(supabase, teacherId, classId);
  if (owned.kind !== "ok") return owned;

  // Only now that ownership is established. A left join on the profile, not
  // `!inner`: a pending invitation has no `student_id` yet, and requiring one
  // would hide exactly the rows the teacher most needs to see.
  const { data: members, error: rosterError } = await supabase
    .from("class_members")
    .select(
      "id, join_status, invited_email, invited_name, invited_at, invite_email_sent_at, joined_at, profiles!class_members_student_id_fkey(full_name, email)",
    )
    .eq("class_id", classId)
    .in("join_status", PRESENT)
    .is("removed_at", null)
    .order("created_at", { ascending: true });

  if (rosterError) {
    logDbError("class_members.select", rosterError);
    return { kind: "error" };
  }

  const roster: RosterEntry[] = (members ?? []).map((member) => {
    const claimed = member.join_status === "joined";

    return {
      membershipId: member.id,
      // Narrowed from the full enum: `PRESENT` is the query's own filter, and
      // `departed` cannot reach here.
      status: claimed ? "joined" : "invited",
      // The profile wins once the invitation is claimed — it is the name the
      // student chose, where `invited_name` is the one the teacher typed.
      name: claimed
        ? (member.profiles?.full_name ?? member.invited_name)
        : member.invited_name,
      email: claimed
        ? (member.profiles?.email ?? member.invited_email)
        : member.invited_email,
      joinedAt: member.joined_at,
      invitedAt: member.invited_at,
      inviteEmailSentAt: member.invite_email_sent_at,
    };
  });

  return {
    kind: "ok",
    detail: {
      ...owned.fields,
      studentCount: roster.filter((entry) => entry.status === "joined").length,
      pendingCount: roster.filter((entry) => entry.status === "invited").length,
      roster,
      inviteCode: await loadInviteCode(supabase, classId),
    },
  };
}

/**
 * The class's usable invitation code, if it has one.
 *
 * The four conditions below are the same four `get_class_invite_preview`
 * applies, and they are matched deliberately: a code this returns but that RPC
 * rejects would be a link the teacher hands out and the student cannot use.
 *
 * `use_count < max_uses` is settled here rather than in the query because
 * PostgREST filters compare a column to a literal, not to another column.
 * Expiry could be sent as a filter, but is kept alongside it so all four rules
 * read as one list.
 *
 * Exported because two other callers were asking `class_invite_codes` the same
 * question with only half the rules — `is_active` and `revoked_at`, no expiry
 * and no exhaustion. `class_invite_codes.expires_at` defaults to thirty days
 * out, so that gap is reached by simply waiting: `/onboarding/invite` would
 * print a dead link, and `inviteStudentByEmail` would email one, both while
 * `/join/[code]` correctly refused it. One implementation is the fix; a second
 * copy of four conditions is how they diverged in the first place.
 */
export async function loadInviteCode(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("class_invite_codes")
    .select("code, expires_at, max_uses, use_count")
    .eq("class_id", classId)
    .eq("is_active", true)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    logDbError("class_invite_codes.select", error);
    return null;
  }

  const now = Date.now();

  const usable = (data ?? []).find(
    (row) =>
      (row.expires_at === null || Date.parse(row.expires_at) > now) &&
      (row.max_uses === null || row.use_count < row.max_uses),
  );

  return usable?.code ?? null;
}
