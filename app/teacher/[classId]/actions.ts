"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { inviteStudentByEmail } from "@/app/onboarding/actions";
import { isAttendanceStatus } from "@/lib/attendance";
import {
  isPerformance,
  isSkill,
  NOTE_MAX_LENGTH,
  TOPIC_MAX_LENGTH,
} from "@/lib/lesson-log";
import { requireTeacher } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import {
  isUuid,
  loadClassSession,
  loadEditableClass,
  type ClassSession,
  type TeacherClassFields,
} from "@/lib/teacher";
import { instantOf, zonedCalendarDate } from "@/lib/time";

/**
 * Everything a teacher does to one class from its own page: manage the roster —
 * remove a student, cancel an invitation, resend one — and record a lesson.
 *
 * All four are the same shape as `updateClass`, for the same reasons. A Server
 * Function is a POST endpoint, so each one re-establishes who is calling
 * through `requireTeacher()` and re-establishes what they own through
 * `loadEditableClass()` — the fact that the only link to it sits on a page that
 * already did both is not a guard. `authoriseClass` is that pair, written once.
 *
 * No bound argument is trusted. `classId` names the class and `membershipId`
 * names the row; `authoriseClass` turns the first into an ownership decision,
 * and every roster write carries `.eq("class_id", classId)` alongside
 * `.eq("id", membershipId)` so a membership id from somebody else's class
 * matches nothing and writes nothing. Underneath both,
 * `class_members_teacher_all` and `class_sessions_teacher_all` refuse any
 * statement touching a class outside `app.my_class_ids()`. The URL selects a
 * row; it does not grant one.
 *
 * Only `createSession` takes a `FormData`, because only it has anything to
 * read: a date, two times and a title. The three roster actions take none at
 * all, so there is nothing on those forms an attacker could put a value into.
 * Neither kind takes a teacher id, a class-ownership flag or a redirect target
 * — those are derived, every time, from the session cookie and the URL segment.
 *
 * Removal is soft — `removed_at`, never DELETE. Six composite foreign keys in
 * `20260828000400` and `20260828000500` reference `class_members (id, class_id)`
 * with `on delete cascade`, so deleting a membership would take that student's
 * attendance, scores, homework, reports and tuition history with it. Setting
 * `removed_at` is also what the read layer already understands: every roster
 * query filters `removed_at is null`, and `app.my_student_class_ids()` and
 * `app.my_teacher_ids()` both exclude a removed member, so the class closes to
 * them at the RLS layer without a single row being destroyed.
 */

/** Redirects with a message attached. Returns `never` so callers narrow. */
function failTo(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

/** Records a database failure for the operator without echoing it to the user. */
function logDbError(
  operation: string,
  error: { code?: string; message?: string; details?: string | null },
): void {
  console.error(`[teacher] ${operation} failed`, {
    code: error.code,
    message: error.message,
    details: error.details ?? undefined,
  });
}

/**
 * Establishes the caller and that the class named by the URL is theirs.
 *
 * The single gate every action in this file passes through, and the whole of
 * the authorisation: an authenticated user, resolved to a teacher, resolved to
 * a class that teacher owns. The `classId` chooses which class to ask about; the
 * answer comes from `loadEditableClass`, whose `teacher_id` filter is the
 * authenticated user's id and nothing the browser sent.
 *
 * Under it, unchanged and untouched, `classes_teacher_all` and
 * `class_sessions_teacher_all` resolve through `app.my_class_ids()`, so a
 * statement aimed at another teacher's class matches no rows even if this check
 * were removed. Two layers that agree; only one of them is the application's.
 *
 * `failPath` is where a failed *read* returns to, and is always built by the
 * caller from the bound segment. Nothing submitted can name a destination.
 *
 * The class's own columns come back with the decision, so callers that need one
 * — `createSession` needs `timezone` — do not pay for a second lookup. So does
 * the teacher's id, which `recordAttendance` stamps into `recorded_by`: it comes
 * from here, where it was derived from the cookie, and never from a form.
 */
async function authoriseClass(
  classId: string,
  failPath: string,
): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  teacherId: string;
  fields: TeacherClassFields;
}> {
  const teacher = await requireTeacher();

  // A segment that cannot name a class is a wrong link, not a server fault.
  if (!isUuid(classId)) {
    notFound();
  }

  const supabase = await createClient();

  // The same loader the class page and the edit page use, filtered by the
  // authenticated teacher's id. One answer to "may this teacher touch this
  // class", rather than one per feature.
  const owned = await loadEditableClass(supabase, teacher.userId, classId);

  if (owned.kind === "not-found") {
    notFound();
  }

  if (owned.kind === "error") {
    // A failed read is not "no such class". See `updateClass`.
    failTo(failPath, "We could not load this class. Please try again.");
  }

  return { supabase, teacherId: teacher.userId, fields: owned.fields };
}

/**
 * The same gate, plus the shape of the second id a roster action carries.
 *
 * The order is deliberate. Ownership is settled *before* the membership id is
 * looked at, so a request naming another teacher's class gets the same 404 it
 * would get for a class that does not exist, whatever it put in the second
 * argument — a forger cannot learn from the difference between "not your class"
 * and "no such member".
 */
async function authoriseRoster(
  classId: string,
  membershipId: string,
): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  classPath: string;
}> {
  const classPath = `/teacher/${classId}`;
  const { supabase } = await authoriseClass(classId, classPath);

  if (!isUuid(membershipId)) {
    failTo(classPath, "That person is no longer on this class list.");
  }

  return { supabase, classPath };
}

/**
 * Soft-removes one membership, in one state, in one class.
 *
 * The filter is the state check: `join_status` and `removed_at` are part of the
 * WHERE clause rather than something read first and asserted, so two teachers
 * clicking at once cannot both succeed and the row cannot change underneath the
 * decision. Zero rows affected means the row is not in this class, is not in
 * the expected state, or has already gone — reported as a stale page, not as a
 * 404, because the class itself is real and is the caller's.
 */
async function softRemove(
  classId: string,
  membershipId: string,
  expected: "joined" | "invited",
  classPath: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
  gone: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("class_members")
    // The only column written. `join_status` deliberately stays as it was:
    // the enum is ('invited', 'joined', 'departed') and `departed` is the
    // account-deletion tombstone written by `app.anonymise_departed_student`,
    // not "left this class". Removal is `removed_at` and nothing else.
    .update({ removed_at: new Date().toISOString() })
    .eq("id", membershipId)
    // Scoping to the class is what makes a membership id from another class —
    // including one of this teacher's own — match nothing.
    .eq("class_id", classId)
    .eq("join_status", expected)
    .is("removed_at", null)
    .select("id");

  if (error) {
    logDbError("class_members.update(removed_at)", error);
    failTo(classPath, "We could not update this class list. Please try again.");
  }

  if (!data || data.length === 0) {
    failTo(classPath, gone);
  }
}

/**
 * Takes a joined student off this class list.
 *
 * Affects exactly one row of `class_members`. The student's auth account, their
 * profile, their memberships of other classes and this class's ownership are
 * all untouched, because none of them is `class_members.id = membershipId and
 * class_id = classId`. A student in two classes stays in the other one: the
 * membership is per class, and this names one of them.
 *
 * The row survives, so everything recorded against it survives with it. What
 * changes is what `removed_at is null` selects — the roster, the counts on
 * `/teacher`, and, through `app.my_student_class_ids()`, the student's own
 * access to the class.
 */
export async function removeStudent(classId: string, membershipId: string) {
  const { supabase, classPath } = await authoriseRoster(classId, membershipId);

  await softRemove(
    classId,
    membershipId,
    "joined",
    classPath,
    supabase,
    "That student is no longer on this class list.",
  );

  // The list, the detail page and the sidebar are rendered per request, but the
  // client router caches them across the redirect. See `updateClass`.
  revalidatePath("/teacher", "layout");
  redirect(classPath);
}

/**
 * Withdraws an invitation that was never claimed.
 *
 * The same write as `removeStudent` against the other present state, which is
 * also what frees the address to be invited again:
 * `class_members_class_invited_email_key` is unique over
 * `(class_id, invited_email)` only `where removed_at is null`, so the cancelled
 * row stops blocking a fresh invitation to the same person.
 *
 * It does not revoke the class invitation link. The link is one code for the
 * whole class in `class_invite_codes`, so revoking it would lock out everyone
 * who has not joined yet; someone who kept a copy of an emailed link can still
 * use it, exactly as they could before they were ever invited by email.
 */
export async function cancelInvitation(classId: string, membershipId: string) {
  const { supabase, classPath } = await authoriseRoster(classId, membershipId);

  await softRemove(
    classId,
    membershipId,
    "invited",
    classPath,
    supabase,
    "That invitation is no longer pending.",
  );

  revalidatePath("/teacher", "layout");
  redirect(classPath);
}

/**
 * Sends the invitation email again, to the address already on the row.
 *
 * Deliberately not a second invitation path. It reads the address out of the
 * membership it was pointed at and then hands the work to
 * `inviteStudentByEmail`, which is the one place that knows how to check the
 * class's invite code against all four of `/join/[code]`'s rules, compose the
 * message, handle `MailNotConfiguredError`, and stamp `invite_email_sent_at`
 * only on a confirmed send. A resend therefore cannot drift from a first send,
 * and there is no new mail architecture here to configure or to get wrong.
 *
 * The address is never submitted. It comes from the row, under the same
 * class-scoped filter as the other two actions, so this cannot be turned into a
 * way to mail an arbitrary address from the platform.
 *
 * `inviteStudentByEmail` finds the existing row rather than inserting one —
 * `(class_id, invited_email)` is unique among rows that have not been removed —
 * so this resends the invitation instead of creating a second one, and it ends
 * in its own redirect back to this class.
 */
export async function resendInvitation(classId: string, membershipId: string) {
  const { supabase, classPath } = await authoriseRoster(classId, membershipId);

  const { data: member, error } = await supabase
    .from("class_members")
    .select("invited_email")
    .eq("id", membershipId)
    .eq("class_id", classId)
    .eq("join_status", "invited")
    .is("removed_at", null)
    .maybeSingle();

  if (error) {
    logDbError("class_members.select(invited_email)", error);
    failTo(classPath, "We could not send that invitation. Please try again.");
  }

  // No row, or a row with no address: a student invited by link alone has
  // nothing to send to.
  if (!member?.invited_email) {
    failTo(classPath, "That invitation is no longer pending.");
  }

  const formData = new FormData();
  formData.set("email", member.invited_email);

  // Redirects, so nothing after this runs. `requireTeacher` is memoised per
  // request, so re-establishing identity inside it costs nothing.
  await inviteStudentByEmail(classId, "class", formData);
}

/** `<input type="date">` submits `YYYY-MM-DD`, and nothing else does. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `<input type="time">` submits `HH:MM`, or `HH:MM:SS` when a sub-minute step
 * is set. Neither form has a step, but accepting seconds costs one group and
 * means a browser that sends them is not turned away for it.
 */
const ISO_TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** One submitted field as a trimmed string; absent and non-text alike as "". */
function readText(formData: FormData, name: string): string {
  const raw = formData.get(name);
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * A real calendar date, or null.
 *
 * The same round-trip check `readDate` makes in `app/onboarding/actions.ts`: the
 * pattern alone would accept 2026-02-31, which `Date.UTC` silently rolls
 * forward to 3 March rather than rejecting.
 */
function readCalendarDate(raw: string): string | null {
  if (!ISO_DATE.test(raw)) return null;

  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString().slice(0, 10) === raw ? raw : null;
}

/**
 * Records one lesson against this class.
 *
 * A `class_sessions` row, which is the schema's own representation of "this
 * class met, or will meet, at this time" — the table attendance, lesson logs and
 * homework already hang their `session_id` off. Nothing new is introduced to
 * hold a lesson, and nothing here duplicates `classes.schedule_note`, which the
 * migration itself labels display-only with `class_sessions` authoritative.
 *
 * The form supplies a date, two times and an optional title. It does not supply
 * the class — that is the bound segment — and it does not supply the teacher,
 * which is never a field at all: `authoriseClass` re-derives it from the session
 * cookie on every call, so a request that names another teacher's class is a
 * 404 before a single value is read off the form.
 *
 * Times are wall-clock in `classes.timezone` and are converted once, here, by
 * `instantOf`. See `lib/time.ts` for why that is not `new Date(...)`.
 *
 * `status` is left to its `'scheduled'` default and `ends_at > starts_at` is
 * checked before the insert as well as by the table — the constraint is the
 * guarantee, this is the sentence the teacher can act on.
 */
export async function createSession(classId: string, formData: FormData) {
  const newPath = `/teacher/${classId}/sessions/new`;
  const { supabase, fields } = await authoriseClass(classId, newPath);

  const date = readCalendarDate(readText(formData, "date"));

  if (!date) {
    failTo(newPath, "Please choose a date for this lesson.");
  }

  const startTime = readText(formData, "start_time");
  const endTime = readText(formData, "end_time");

  if (!ISO_TIME.test(startTime) || !ISO_TIME.test(endTime)) {
    failTo(newPath, "Please enter a start time and an end time.");
  }

  const startsAt = instantOf(fields.timezone, date, startTime);
  const endsAt = instantOf(fields.timezone, date, endTime);

  // Mirrors `class_sessions_ends_after_starts`. A lesson running past midnight
  // would need a second date to express, which this form does not ask for, so
  // the two times are read on the one day the teacher chose.
  if (endsAt.getTime() <= startsAt.getTime()) {
    failTo(newPath, "The end time must be after the start time.");
  }

  const title = readText(formData, "title");

  if (title.length > 200) {
    failTo(newPath, "That lesson title is too long.");
  }

  const { error } = await supabase.from("class_sessions").insert({
    // The one column the form does not supply, and the one that must not come
    // from it. See `createClass`.
    class_id: classId,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    // Empty is meaningful: an untitled lesson is the date it happened on, and
    // "" would be a title that renders as a blank line.
    title: title === "" ? null : title,
  });

  if (error) {
    // `class_sessions_class_starts_key` is unique over (class_id, starts_at).
    // The constraint stays the enforcement; this is only its wording. Checking
    // for the row first would be both a second query and a race.
    if (error.code === "23505") {
      failTo(newPath, "This class already has a lesson starting at that time.");
    }

    logDbError("class_sessions.insert", error);
    failTo(newPath, "We could not save this lesson. Please try again.");
  }

  // The class page lists the lessons and the sidebar is drawn from the same
  // layout, both cached by the client router across the redirect.
  revalidatePath("/teacher", "layout");
  redirect(`/teacher/${classId}`);
}

/**
 * The class gate, plus the session that must sit inside it.
 *
 * The second half of the chain the milestone requires: authenticated teacher →
 * owned class → session *in that class*. `loadClassSession` puts both
 * `id = sessionId` and `class_id = classId` in the WHERE clause, so a session id
 * belonging to another class — another teacher's or this teacher's own other
 * class — matches no row and is reported as a session that does not exist. The
 * session id is never the thing that selects the row on its own.
 *
 * Ownership of the class is settled first, so a forged pair learns nothing from
 * which of the two ids was wrong: both orders of mistake end in the same 404.
 *
 * The session and the class's timezone come back with it because they were both
 * read to get here. A caller that needs the lesson's own date — `createLessonLog`
 * does — must not go and fetch it again, and must certainly not accept one from
 * the form.
 */
async function authoriseSession(
  classId: string,
  sessionId: string,
): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  teacherId: string;
  session: ClassSession;
  timezone: string;
  sessionPath: string;
}> {
  const classPath = `/teacher/${classId}`;
  const { supabase, teacherId, fields } = await authoriseClass(
    classId,
    classPath,
  );

  const found = await loadClassSession(supabase, classId, sessionId);

  if (found.kind === "not-found") {
    notFound();
  }

  if (found.kind === "error") {
    // A failed read is not "no such lesson". Back to the class, which is known
    // to exist and is known to be this teacher's.
    failTo(classPath, "We could not load this lesson. Please try again.");
  }

  // Built from two segments that have now both been proved. Nothing submitted
  // names a destination.
  return {
    supabase,
    teacherId,
    session: found.session,
    timezone: fields.timezone,
    sessionPath: `/teacher/${classId}/sessions/${sessionId}`,
  };
}

/**
 * Marks one student present, late, absent or excused at one session.
 *
 * The whole chain is re-established here, in order, on every call:
 *
 *   authenticated user → teacher → owned class → session in that class
 *     → active member of that class → attendance for that (session, member)
 *
 * Three of the four arguments are bound segments and none of them is trusted:
 * `authoriseSession` turns the first two into an ownership decision, and the
 * membership is then re-read filtered by `class_id` and by being active, so an
 * id naming somebody else's student matches nothing. The fourth, `status`, is
 * the only value that comes off the form, and it is checked against
 * `public.attendance_status`'s four values before it is used. There is no
 * teacher id, no ownership flag and no redirect target anywhere in the request.
 *
 * Beneath all of it the schema says the same thing twice more:
 * `session_attendance_teacher_all` admits only `app.my_class_ids()`, and both
 * composite foreign keys carry `class_id`, so a member of one class physically
 * cannot be attached to another class's session — the migration's own note.
 *
 * The write is an upsert on `session_attendance_session_member_key`
 * `(session_id, class_member_id)`, which is the constraint the migration says
 * exists to make "roster marking an upsert". Changing a mark is therefore the
 * same statement as making one, resolved by the database in one round trip: no
 * read-then-insert, no duplicate row, and no race between two teachers marking
 * the same student.
 */
export async function recordAttendance(
  classId: string,
  sessionId: string,
  membershipId: string,
  formData: FormData,
) {
  const { supabase, teacherId, sessionPath } = await authoriseSession(
    classId,
    sessionId,
  );

  if (!isUuid(membershipId)) {
    failTo(sessionPath, "That student is no longer on this class list.");
  }

  const status = readText(formData, "status");

  if (!isAttendanceStatus(status)) {
    failTo(sessionPath, "Please choose one of the attendance options.");
  }

  // Steps 8 and 9 of the chain: the membership is this class's, and it is
  // active. The composite foreign key already refuses a member from another
  // class, but it knows nothing about `removed_at` — a removed student's
  // history is kept, and this is what stops a new mark being added to it.
  const { data: member, error: memberError } = await supabase
    .from("class_members")
    .select("id")
    .eq("id", membershipId)
    .eq("class_id", classId)
    .eq("join_status", "joined")
    .is("removed_at", null)
    .maybeSingle();

  if (memberError) {
    logDbError("class_members.select(active)", memberError);
    failTo(sessionPath, "We could not save this attendance. Please try again.");
  }

  if (!member) {
    failTo(sessionPath, "That student is no longer on this class list.");
  }

  const { error } = await supabase.from("session_attendance").upsert(
    {
      session_id: sessionId,
      class_member_id: membershipId,
      // Denormalised on the row and load-bearing: it is half of both composite
      // foreign keys. It is the proved segment, never a submitted value.
      class_id: classId,
      status,
      // Who marked it, from the session cookie. `note` is deliberately absent
      // from this list so that changing a mark leaves any existing note alone.
      recorded_by: teacherId,
    },
    { onConflict: "session_id,class_member_id" },
  );

  if (error) {
    logDbError("session_attendance.upsert", error);
    failTo(sessionPath, "We could not save this attendance. Please try again.");
  }

  revalidatePath(sessionPath);
  redirect(sessionPath);
}

/**
 * Writes one lesson note against one student at one session.
 *
 * The chain is the same one `recordAttendance` establishes, in the same order,
 * on every call:
 *
 *   authenticated user → teacher → owned class → session in that class
 *     → active member of that class → lesson log for that (session, member)
 *
 * `lesson_logs` is not what the milestone's wording suggests, and the schema
 * wins. It is a per-student observation, not a per-lesson memo: `class_member_id`
 * is NOT NULL and so are `skill`, `topic`, `performance` and `lesson_date`, while
 * `session_id` is the nullable column and `note` is the only free text. A row
 * therefore cannot be written without naming a student and saying something
 * about their work, which is why the form collects four fields rather than one.
 *
 * Three of those four are checked against the database's own vocabulary before
 * they are used: `skill` and `performance` against their enums, `topic` against
 * `lesson_logs_topic_length`'s 1–300. The fourth, `note`, has no constraint in
 * the schema, so its cap is the application's — see `lib/lesson-log.ts`. Nothing
 * is truncated: over-long input is refused with the text still in the browser.
 *
 * Nothing that decides anything comes off the form. `class_id` is the proved
 * segment, `created_by` is the session cookie's teacher, and `lesson_date` is
 * computed from the session's own `starts_at` on the class's clock — so a lesson
 * that starts after midnight local time is filed under the day it was taught
 * rather than the day UTC happened to be having. The redirect is built from two
 * segments that have already been proved.
 *
 * There is no upsert here and no unique constraint to upsert against: the table
 * has neither, which is the schema saying a session may carry many notes. A
 * second note is a second row, and no existing one is touched.
 */
export async function createLessonLog(
  classId: string,
  sessionId: string,
  formData: FormData,
) {
  const { supabase, teacherId, session, timezone, sessionPath } =
    await authoriseSession(classId, sessionId);

  const membershipId = readText(formData, "class_member_id");

  if (!isUuid(membershipId)) {
    failTo(sessionPath, "Please choose which student this note is about.");
  }

  const skill = readText(formData, "skill");

  if (!isSkill(skill)) {
    failTo(sessionPath, "Please choose one of the skills.");
  }

  const performance = readText(formData, "performance");

  if (!isPerformance(performance)) {
    failTo(sessionPath, "Please choose how the student did.");
  }

  // `readText` has already trimmed, which is what the CHECK measures: it is
  // `length(btrim(topic))`, so a topic of spaces is empty to the database too.
  const topic = readText(formData, "topic");

  if (topic.length === 0) {
    failTo(sessionPath, "Please say what this lesson covered.");
  }

  if (topic.length > TOPIC_MAX_LENGTH) {
    failTo(
      sessionPath,
      `Please keep the topic to ${TOPIC_MAX_LENGTH} characters or fewer.`,
    );
  }

  const note = readText(formData, "note");

  if (note.length === 0) {
    failTo(sessionPath, "Please write a note before adding it.");
  }

  if (note.length > NOTE_MAX_LENGTH) {
    failTo(
      sessionPath,
      `Please keep the note to ${NOTE_MAX_LENGTH} characters or fewer.`,
    );
  }

  // The membership is this class's, and it is active — the same pair of facts
  // `recordAttendance` re-establishes, for the same reasons. The composite
  // foreign key `(class_member_id, class_id)` already refuses a member from
  // another class; it knows nothing about `removed_at`.
  const { data: member, error: memberError } = await supabase
    .from("class_members")
    .select("id")
    .eq("id", membershipId)
    .eq("class_id", classId)
    .eq("join_status", "joined")
    .is("removed_at", null)
    .maybeSingle();

  if (memberError) {
    logDbError("class_members.select(lesson log)", memberError);
    failTo(sessionPath, "We could not save this note. Please try again.");
  }

  if (!member) {
    failTo(sessionPath, "That student is no longer on this class list.");
  }

  const { error } = await supabase.from("lesson_logs").insert({
    session_id: sessionId,
    class_member_id: membershipId,
    // Half of both composite foreign keys, and the proved segment rather than a
    // submitted value.
    class_id: classId,
    // The day the lesson happened on, read on the class's clock. Never the
    // server's date, and never the browser's.
    lesson_date: zonedCalendarDate(timezone, session.startsAt),
    skill,
    performance,
    topic,
    note,
    // From the session cookie. `mistakes` is left to its `'{}'` default: the
    // chip picker `mistake_tags` exists for is not part of this page.
    created_by: teacherId,
  });

  if (error) {
    logDbError("lesson_logs.insert", error);
    failTo(sessionPath, "We could not save this note. Please try again.");
  }

  revalidatePath(sessionPath);
  redirect(sessionPath);
}
