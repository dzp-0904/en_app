import "server-only";

import type { AttendanceStatus } from "@/lib/attendance";
import type { CourseType } from "@/lib/course-type";
import type { Performance, Skill } from "@/lib/lesson-log";
import type { MemberStatus, ScoreEntryType } from "@/lib/score";
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
  /**
   * The IANA zone the class meets in — `'Asia/Ho_Chi_Minh'` unless a row says
   * otherwise. NOT NULL in the schema, and the wall clock every session time is
   * written and read in. See `lib/time.ts`.
   */
  timezone: string;
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
  /**
   * `class_members.target_band` — the goal set for this one student, null until
   * a teacher sets it.
   *
   * Not `classes.target_band`, which is the class's own default and a different
   * column: a class aiming at 6.5 can hold a student working towards 7.5. The
   * same distinction `MemberBands.targetBand` draws, read from the table here
   * because the roster does not otherwise touch the band views.
   */
  targetBand: number | null;
  /**
   * `class_members.strengths` and `class_members.focus_areas` — the teacher's
   * own notes on what this student does well and what they are working on.
   *
   * Both are `text[] not null default '{}'`, so an empty array is the real
   * "nothing recorded" and null never occurs. Kept as arrays rather than joined
   * into a string because order is meaningful and the editor writes them back
   * one tag at a time.
   */
  strengths: string[];
  focusAreas: string[];
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

/**
 * One lesson: an actual teaching occurrence of a class.
 *
 * A row of `class_sessions`, which belongs directly to `classes` — not to a
 * membership. A session happens whether or not any particular student turns up,
 * and `session_attendance (session_id, class_id)` is where the two meet later.
 *
 * `startsAt` and `endsAt` are the raw `timestamptz` values, i.e. instants, and
 * are deliberately not formatted here: only `classes.timezone` says what clock
 * they should be read on, so `lib/time.ts` does that at the point of display.
 *
 * There is no lesson number in the schema, and none is invented here. Position
 * in this list — which is ordered by `startsAt` — is the only ordinal there is.
 */
export type ClassSession = {
  sessionId: string;
  startsAt: string;
  endsAt: string;
  /** Optional in the schema; a lesson may simply be the date it happened on. */
  title: string | null;
  status: "scheduled" | "completed" | "cancelled";
};

export type ClassSessionResult =
  | { kind: "ok"; session: ClassSession }
  | { kind: "not-found" }
  | { kind: "error" };

/**
 * One active student on a session's attendance list, with whatever was recorded
 * for them at that session.
 *
 * `attendance` is null when no `session_attendance` row exists for the pair, and
 * that is a real state rather than a missing one: rows appear only when a
 * teacher records something, and `v_member_session_attendance` deliberately
 * counts an unmarked session against a student so the gap stays visible. Nothing
 * is manufactured to fill it — the page says "Not recorded".
 */
export type SessionAttendee = {
  /** class_members.id — what `session_attendance.class_member_id` refers to. */
  membershipId: string;
  name: string | null;
  email: string | null;
  attendance: AttendanceStatus | null;
};

/**
 * One lesson note, and who it is about.
 *
 * `lesson_logs` is per student, not per lesson — `class_member_id` is NOT NULL
 * and `session_id` is the nullable column — so a session has as many of these as
 * the teacher has written, and each one names a student. The table has no unique
 * constraint at all, so more than one note per student per session is permitted
 * and this type does not pretend otherwise.
 *
 * `studentName` is null only where the roster no longer answers for the member,
 * which the composite `on delete cascade` makes unreachable today. `note` is
 * null for a row written without one; the column is nullable and this
 * application's own form is what refuses an empty one.
 *
 * `lesson_date` is deliberately absent. It is derived from the session's own
 * start, so on a session page it is a second copy of the date already in the
 * header, and showing it twice would invite the reading that the two can differ.
 */
export type LessonNote = {
  noteId: string;
  /** class_members.id — the student the observation is about. */
  membershipId: string;
  studentName: string | null;
  skill: Skill;
  performance: Performance;
  topic: string;
  note: string | null;
  createdAt: string;
};

/** `classes.id` and `class_members.id` are uuid columns. */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a string could name a row at all.
 *
 * Exported so the Server Actions apply the same rule the loaders do. Without it
 * a mistyped id reaches PostgREST as `22P02 invalid input syntax for type uuid`
 * — a database error where the truth is simply that no such row exists. Both
 * ids a roster action is handed are uuids, so one predicate covers them.
 */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** The columns every class view needs, in one place so the two agree. */
const CLASS_COLUMNS =
  "id, name, course_type, course_type_other, target_band, start_date, end_date, schedule_note, timezone";

/**
 * A lesson note and the name to show beside it, in one statement.
 *
 * The embed is hinted with `lesson_logs_member_fk` because that constraint is
 * composite — `(class_member_id, class_id)` — so PostgREST has to be told which
 * relationship is meant rather than inferring it from a single column. The
 * nested hint is the one the roster queries already use.
 */
const LESSON_LOG_COLUMNS =
  "id, class_member_id, skill, performance, topic, note, created_at, class_members!lesson_logs_member_fk(invited_name, profiles!class_members_student_id_fkey(full_name))";

/** The columns every session view needs, in one place so the two agree. */
const SESSION_COLUMNS = "id, starts_at, ends_at, title, status";

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
    timezone: row.timezone,
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
      timezone: found.timezone,
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
      "id, join_status, invited_email, invited_name, invited_at, invite_email_sent_at, joined_at, target_band, strengths, focus_areas, profiles!class_members_student_id_fkey(full_name, email)",
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
      targetBand: member.target_band,
      strengths: member.strengths,
      focusAreas: member.focus_areas,
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

/**
 * Every lesson recorded against one class, earliest first.
 *
 * A separate loader rather than another field on `loadTeacherClass`, for the
 * same reason the counts are a separate query: a class page whose session list
 * fails should still show the class, its invitation link and its roster, with
 * the failure confined to the section that could not be read. Folding this into
 * the three-arm result would turn one failed query into a whole-page error.
 *
 * `null` means the query failed and `[]` means the class has no lessons yet —
 * the module's rule throughout, and the distinction the class page needs in
 * order to avoid announcing "no lessons" on the strength of a database fault.
 *
 * No `teacher_id` filter, because there is no `teacher_id` on this table to
 * filter by. Callers reach here only after `loadEditableClass` has proved the
 * class is theirs, and underneath that `class_sessions_teacher_all` admits only
 * `app.my_class_ids()`, so a `classId` the caller does not own returns nothing
 * even if a future caller forgets the check. Same arrangement as
 * `loadInviteCode`.
 */
export async function loadClassSessions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string,
): Promise<ClassSession[] | null> {
  const { data, error } = await supabase
    .from("class_sessions")
    .select(SESSION_COLUMNS)
    .eq("class_id", classId)
    // Chronological, which is also what the `(class_id, starts_at)` unique
    // constraint's index already orders — the schema's own note in
    // `20260828000600_indexes.sql` says it serves exactly this scan.
    .order("starts_at", { ascending: true });

  if (error) {
    logDbError("class_sessions.select", error);
    return null;
  }

  return (data ?? []).map((row) => ({
    sessionId: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    title: row.title,
    status: row.status,
  }));
}

/**
 * One lesson of one class — selected by both ids at once.
 *
 * The two filters are the authorisation, and they are both in the WHERE clause
 * on purpose. Fetching the session by `id` alone and then comparing its
 * `class_id` in TypeScript would read another teacher's row into this process
 * before deciding not to show it, and every such comparison is one `!==` away
 * from being wrong. Here a session id from a class other than `classId` simply
 * matches nothing, so "not yours" and "does not exist" are the same event
 * rather than two branches that have to be kept saying the same thing.
 *
 * Callers reach here only after `loadEditableClass` has proved `classId` is
 * theirs, so `class_id = classId` is what carries ownership down to the session.
 * Underneath, `class_sessions_teacher_all` admits only `app.my_class_ids()`.
 *
 * The three arms mean what they mean everywhere else in this module: a failed
 * query is `error`, never `not-found`.
 */
export async function loadClassSession(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string,
  sessionId: string,
): Promise<ClassSessionResult> {
  // Before the round trip, so a mistyped link is a 404 rather than `22P02
  // invalid input syntax for type uuid` arriving as a server fault.
  if (!UUID.test(classId) || !UUID.test(sessionId)) return { kind: "not-found" };

  const { data: found, error } = await supabase
    .from("class_sessions")
    .select(SESSION_COLUMNS)
    .eq("id", sessionId)
    .eq("class_id", classId)
    .maybeSingle();

  if (error) {
    logDbError("class_sessions.select(one)", error);
    return { kind: "error" };
  }

  if (!found) return { kind: "not-found" };

  return {
    kind: "ok",
    session: {
      sessionId: found.id,
      startsAt: found.starts_at,
      endsAt: found.ends_at,
      title: found.title,
      status: found.status,
    },
  };
}

/**
 * The class's active students, each with whatever attendance this session has
 * recorded for them.
 *
 * Two queries rather than one embedded join, for the reason the class counts
 * are two queries: PostgREST's filters on an embedded relation turn the embed
 * into an inner join unless coaxed, and this needs the opposite — every active
 * member appears, with or without a row. Two plain statements say that plainly.
 * It is not an N+1: neither query is per student.
 *
 * `join_status = 'joined'` and `removed_at is null` are what "active" means, and
 * they agree with the rest of the system rather than inventing a third rule.
 * `app.my_student_class_ids()` uses exactly this pair to decide whether a class
 * is still open to a student, and `v_member_session_attendance` requires
 * `joined_at is not null` for the same reason: an unclaimed invitation is not
 * somebody who can have been in the room. A removed member disappears from this
 * list, while every `session_attendance` row ever recorded against them stays
 * exactly where it is — nothing here writes, and nothing here deletes.
 *
 * `null` means a query failed, `[]` means the class has no active students.
 */
export async function loadSessionAttendance(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string,
  sessionId: string,
): Promise<SessionAttendee[] | null> {
  const { data: members, error: rosterError } = await supabase
    .from("class_members")
    .select(
      "id, invited_name, profiles!class_members_student_id_fkey(full_name, email)",
    )
    .eq("class_id", classId)
    .eq("join_status", "joined")
    .is("removed_at", null)
    // The order the class page already lists students in.
    .order("created_at", { ascending: true });

  if (rosterError) {
    logDbError("class_members.select(attendance)", rosterError);
    return null;
  }

  if (!members || members.length === 0) return [];

  // Scoped to the session AND the class. The composite foreign key
  // `(session_id, class_id)` already makes a row that disagrees impossible to
  // store, so this filter is the query saying the same thing the schema does.
  const { data: marks, error: markError } = await supabase
    .from("session_attendance")
    .select("class_member_id, status")
    .eq("session_id", sessionId)
    .eq("class_id", classId);

  if (markError) {
    logDbError("session_attendance.select", markError);
    return null;
  }

  const recorded = new Map<string, AttendanceStatus>();
  for (const mark of marks ?? []) recorded.set(mark.class_member_id, mark.status);

  return members.map((member) => ({
    membershipId: member.id,
    // The profile wins over the name the teacher typed, as on the roster.
    name: member.profiles?.full_name ?? member.invited_name,
    email: member.profiles?.email ?? null,
    // Absent from the map means unmarked, which is not the same as `absent`.
    attendance: recorded.get(member.id) ?? null,
  }));
}

/**
 * Every lesson note written against this session, oldest first.
 *
 * One statement for the whole section — not one per student, and not one per
 * note. The name each note is shown under travels with it through the embed
 * rather than being looked up afterwards, so adding a fiftieth note adds no
 * query.
 *
 * Filtered on the session AND the class, like `loadSessionAttendance` and for
 * the same reason: `lesson_logs_session_fk` is `(session_id, class_id)`, so a
 * row that disagreed could never have been stored, and the pair of filters is
 * the query stating what the schema already guarantees. Underneath,
 * `lesson_logs_teacher_all` admits only `app.my_class_ids()`.
 *
 * Ordered by `created_at`, which is the order they were written in. There is no
 * other ordinal — the table carries no sequence column — and `lesson_date` is
 * the same value on every row here, so it could not order anything.
 *
 * `null` means the query failed, `[]` means nothing has been written yet.
 */
export async function loadSessionLessonNotes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string,
  sessionId: string,
): Promise<LessonNote[] | null> {
  const { data: logs, error } = await supabase
    .from("lesson_logs")
    .select(LESSON_LOG_COLUMNS)
    .eq("session_id", sessionId)
    .eq("class_id", classId)
    .order("created_at", { ascending: true });

  if (error) {
    logDbError("lesson_logs.select", error);
    return null;
  }

  return (logs ?? []).map((log) => ({
    noteId: log.id,
    membershipId: log.class_member_id,
    // The profile wins over the name the teacher typed, as on the roster.
    studentName:
      log.class_members?.profiles?.full_name ??
      log.class_members?.invited_name ??
      null,
    skill: log.skill,
    performance: log.performance,
    topic: log.topic,
    note: log.note,
    createdAt: log.created_at,
  }));
}

/**
 * Where one student currently stands, as the database already computes it.
 *
 * Every field here comes from `v_member_current_band` and
 * `v_member_performance_status`, both `security_invoker` views that have existed
 * since the schema was created. Nothing is recalculated: "current band" is the
 * latest entry, "starting band" is the baseline row, and `status` is the
 * comparison between the two most recent comparable entries — three definitions
 * the database owns, and which the application would only be able to disagree
 * with.
 *
 * `targetBand` is `class_members.target_band`, the goal set for this student.
 * It is not `classes.target_band`, which is the class's own default and a
 * different column; the view chose the per-student one, so this does too.
 *
 * Every band is nullable because a student who has never been assessed has no
 * bands, and `null` says that rather than pretending it is a zero.
 */
export type MemberBands = {
  membershipId: string;
  status: MemberStatus;
  targetBand: number | null;
  startOverall: number | null;
  currentOverall: number | null;
  currentReading: number | null;
  currentListening: number | null;
  currentWriting: number | null;
  currentSpeaking: number | null;
  /** The date of the most recent entry, `YYYY-MM-DD` in the class's zone. */
  currentRecordedOn: string | null;
};

/**
 * One recorded entry in a student's band history.
 *
 * A row of `score_entries`, which belongs to a membership and a date — there is
 * no `session_id` on the table, and none is invented here. A lesson's entries
 * are the entries whose `recorded_on` is that lesson's date on the class's own
 * clock, which is exactly how `lesson_logs.lesson_date` is derived too.
 */
export type ScoreEntry = {
  entryId: string;
  membershipId: string;
  studentName: string | null;
  entryType: ScoreEntryType;
  overall: number | null;
  reading: number | null;
  listening: number | null;
  writing: number | null;
  speaking: number | null;
  note: string | null;
  recordedOn: string;
  createdAt: string;
};

/**
 * Where every student in one class currently stands.
 *
 * Two reads of two views, keyed by membership, rather than one read per student:
 * a class with twenty students still asks twice. Both views are filtered on
 * `class_id`, which is the same column their own RLS resolves through, so the
 * filter agrees with the policy rather than standing in for it.
 *
 * `null` means a query failed. A member with no entries still gets an entry in
 * the map, with every band `null` — that is the view's own answer, not an
 * absence, and the difference matters to the caller.
 */
export async function loadClassBands(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string,
): Promise<Map<string, MemberBands> | null> {
  const [bands, statuses] = await Promise.all([
    supabase
      .from("v_member_current_band")
      .select(
        "class_member_id, target_band, start_overall, current_overall, current_reading, current_listening, current_writing, current_speaking, current_recorded_on",
      )
      .eq("class_id", classId),
    supabase
      .from("v_member_performance_status")
      .select("class_member_id, status")
      .eq("class_id", classId),
  ]);

  if (bands.error) {
    logDbError("v_member_current_band.select", bands.error);
    return null;
  }
  if (statuses.error) {
    logDbError("v_member_performance_status.select", statuses.error);
    return null;
  }

  const status = new Map<string, MemberStatus>();
  for (const row of statuses.data ?? []) {
    if (row.class_member_id && row.status) status.set(row.class_member_id, row.status);
  }

  const standing = new Map<string, MemberBands>();
  for (const row of bands.data ?? []) {
    if (!row.class_member_id) continue;
    standing.set(row.class_member_id, {
      membershipId: row.class_member_id,
      // 'stable' is what the view itself returns for a member with nothing to
      // compare, so a missing row and an uneventful one read the same way.
      status: status.get(row.class_member_id) ?? "stable",
      targetBand: row.target_band,
      startOverall: row.start_overall,
      currentOverall: row.current_overall,
      currentReading: row.current_reading,
      currentListening: row.current_listening,
      currentWriting: row.current_writing,
      currentSpeaking: row.current_speaking,
      currentRecordedOn: row.current_recorded_on,
    });
  }

  return standing;
}

/**
 * The band entries recorded on one lesson's date.
 *
 * Scoped to the class and to that date, and joined to the roster only for the
 * student's name — the same embed the lesson-note list uses, and reachable only
 * through the policies that already govern `class_members`.
 *
 * `null` means the query failed, `[]` means nothing was recorded that day.
 */
export async function loadScoreEntriesOn(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string,
  recordedOn: string,
): Promise<ScoreEntry[] | null> {
  const { data: entries, error } = await supabase
    .from("score_entries")
    .select(
      "id, class_member_id, entry_type, overall, reading, listening, writing, speaking, note, recorded_on, created_at, class_members!score_entries_member_fk(invited_name, profiles!class_members_student_id_fkey(full_name))",
    )
    .eq("class_id", classId)
    .eq("recorded_on", recordedOn)
    .order("created_at", { ascending: true });

  if (error) {
    logDbError("score_entries.select", error);
    return null;
  }

  return (entries ?? []).map((entry) => ({
    entryId: entry.id,
    membershipId: entry.class_member_id,
    studentName:
      entry.class_members?.profiles?.full_name ??
      entry.class_members?.invited_name ??
      null,
    entryType: entry.entry_type,
    overall: entry.overall,
    reading: entry.reading,
    listening: entry.listening,
    writing: entry.writing,
    speaking: entry.speaking,
    note: entry.note,
    recordedOn: entry.recorded_on,
    createdAt: entry.created_at,
  }));
}
