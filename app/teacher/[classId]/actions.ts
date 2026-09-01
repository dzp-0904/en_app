"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { inviteStudentByEmail } from "@/app/onboarding/actions";
import { isAttendanceOpen, isAttendanceStatus } from "@/lib/attendance";
import {
  isPerformance,
  isSkill,
  NOTE_MAX_LENGTH,
  TOPIC_MAX_LENGTH,
} from "@/lib/lesson-log";
import type { CourseType } from "@/lib/course-type";
import { requireTeacher } from "@/lib/onboarding";
import {
  BAND_SKILLS,
  isBandScored,
  isScoreEntryType,
  readBand,
  SCORE_NOTE_MAX_LENGTH,
} from "@/lib/score";
import {
  MAX_TAG_LENGTH,
  MAX_TAGS,
  readTags,
  type TagsResult,
} from "@/lib/standing";
import { createClient } from "@/lib/supabase/server";
import {
  isUuid,
  loadClassSession,
  loadEditableClass,
  type ClassSession,
  type TeacherClassFields,
} from "@/lib/teacher";
import {
  isAllowedMaterial,
  loadMaterial,
  materialStoragePath,
  MATERIALS_BUCKET,
  MAX_MATERIAL_BYTES,
} from "@/lib/materials";
import { formatZonedTime, instantOf, zonedCalendarDate } from "@/lib/time";

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
    failTo(failPath, "Chúng tôi chưa tải được lớp học này. Vui lòng thử lại.");
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
  fields: TeacherClassFields;
  classPath: string;
}> {
  const classPath = `/teacher/${classId}`;
  const { supabase, fields } = await authoriseClass(classId, classPath);

  if (!isUuid(membershipId)) {
    failTo(classPath, "Người này không còn trong danh sách lớp.");
  }

  return { supabase, fields, classPath };
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
    failTo(classPath, "Chúng tôi chưa cập nhật được danh sách lớp. Vui lòng thử lại.");
  }

  if (!data || data.length === 0) {
    failTo(classPath, gone);
  }
}

/**
 * Sets, changes or clears one student's target band.
 *
 * The goal is `class_members.target_band`, which already exists and is already
 * read by `v_member_current_band` — so the number the teacher picks here is the
 * same number the student's progress panel shows and the same one
 * `loadClassBands` puts on the session page. Nothing is stored twice.
 *
 * Three writes, one code path. A band sets it, a band changes it, and an empty
 * field clears it back to "not set", because `target_band` is nullable and
 * having no goal yet is a real state rather than a missing one.
 *
 * That last path is the one worth being explicit about. Clearing is an empty
 * *present* field, never an absent one: `formData.has` is checked before the
 * value is read, so a POST that simply omits `targetBand` is refused instead of
 * being read as "the teacher chose Not set". `readText` alone could not tell
 * those apart — it returns "" for both — and the difference is a wiped goal.
 *
 * Everything else is `removeStudent`'s shape. `authoriseRoster` settles the
 * teacher, then the class, then the shape of the membership id, and the state
 * checks live in the WHERE clause rather than in a read-then-assert: a removed
 * student, an unclaimed invitation, a membership from another class and a
 * membership from another teacher's class all match zero rows for the same
 * reason, without a second query that could disagree with the first.
 */
export async function setTargetBand(
  classId: string,
  membershipId: string,
  formData: FormData,
) {
  const { supabase, fields, classPath } = await authoriseRoster(
    classId,
    membershipId,
  );

  // `class_members` has no equivalent of `classes_no_target_band_when_unscored`,
  // so the database would accept an IELTS goal on a General English class. The
  // application does not, for the same reason the session page hides the bands
  // section there: a band is meaningless where nothing is scored on one.
  if (!isBandScored(fields.courseType)) {
    failTo(classPath, "Lớp này không sử dụng band mục tiêu IELTS.");
  }

  if (!formData.has("targetBand")) {
    failTo(classPath, "Chúng tôi chưa lưu được band mục tiêu. Vui lòng thử lại.");
  }

  const submitted = readText(formData, "targetBand");
  const parsed = readBand(submitted);

  // `readBand` is `public.band`'s CHECK written out — in range, on a half
  // point, never rounded — so "6.7", "10", "-1" and "excellent" are all refused
  // here rather than reaching Postgres and coming back as a domain violation.
  if (!parsed.ok) {
    failTo(
      classPath,
      "Band mục tiêu phải là bội số của 0,5 trong khoảng từ 0.0 đến 9.0. Vui lòng kiểm tra lại.",
    );
  }

  const { data, error } = await supabase
    .from("class_members")
    // The only column written. `updated_at` moves on its own, through the
    // `set_updated_at` trigger the table already carries.
    .update({ target_band: parsed.band })
    .eq("id", membershipId)
    // Both ids, as every roster write does: a membership id from another class
    // — including one of this teacher's own — matches nothing.
    .eq("class_id", classId)
    .eq("join_status", "joined")
    .is("removed_at", null)
    .select("id");

  if (error) {
    logDbError("class_members.update(target_band)", error);
    failTo(classPath, "Chúng tôi chưa lưu được band mục tiêu. Vui lòng thử lại.");
  }

  if (!data || data.length === 0) {
    failTo(classPath, "Học viên này không còn trong danh sách lớp.");
  }

  // The roster is what changed, but the student's own progress panel reads the
  // same column through `v_member_current_band`, so the sidebar-level revalidate
  // that `removeStudent` uses is the right breadth here too.
  revalidatePath("/teacher", "layout");
  redirect(classPath);
}

/**
 * Reads one tag list out of the submitted form.
 *
 * Two fields feed one array. `field` carries the tags the editor is already
 * holding, one repeated input per tag, and `addField` carries whatever is still
 * sitting in the "add" box when Save is pressed. Merging them here is what makes
 * a typed-but-not-added tag save instead of vanishing — an easy thing for a
 * teacher to do, and a silent loss if only the chips were read. It is also what
 * lets the editor work with JavaScript switched off, where the box is the only
 * way to add anything at all.
 *
 * An untouched box is "" and adds nothing. A box holding only spaces is not the
 * same thing: the teacher typed something, so it is passed through and refused
 * as blank rather than ignored.
 */
function readSubmittedTags(
  formData: FormData,
  field: string,
  addField: string,
): TagsResult {
  const submitted: unknown[] = formData.getAll(field);
  const added = formData.get(addField);

  if (typeof added === "string" && added !== "") {
    submitted.push(added);
  }

  return readTags(submitted);
}

/** Turns a refusal into words, naming the list that was wrong. */
function describeRejection(result: TagsResult, noun: string): string {
  if (result.ok) return "";

  switch (result.rejection.kind) {
    case "blank":
      return `Mục ${noun} không được để trống. Vui lòng nhập nội dung hoặc xóa mục đó.`;
    case "too-long":
      return `Mỗi ${noun} không được dài quá ${MAX_TAG_LENGTH} ký tự.`;
    case "duplicate":
      return `"${result.rejection.value}" đã có trong danh sách ${noun}.`;
    case "too-many":
      return `Mỗi học viên chỉ ghi nhận tối đa ${MAX_TAGS} ${noun}.`;
    case "shape":
      return `Chúng tôi chưa lưu được danh sách ${noun}. Vui lòng thử lại.`;
  }
}

/**
 * Saves one student's strengths and focus areas together.
 *
 * One action and one write for both columns, because they are one thought: a
 * teacher looking at a student decides what is going well and what to work on
 * in the same moment, and two separate saves would let a card end up half
 * updated. `strengths` and `focus_areas` are both `text[] not null`, so there is
 * no "unset" to represent — clearing a list writes `{}`, which is exactly what
 * the column already defaults to.
 *
 * Validation is `readTags`, applied to each list independently so the message
 * can name which one was wrong. It refuses rather than repairs: an overlong tag
 * comes back as an error instead of a truncated tag, and a repeat comes back as
 * an error instead of quietly disappearing. Neither column has a database
 * constraint to fall back on, so this is the only place either rule exists.
 *
 * Authorisation and the write are `setTargetBand`'s exactly — `authoriseRoster`
 * for the teacher, the class and the shape of the membership id, then all four
 * state checks in the WHERE clause. A removed student, an unclaimed invitation,
 * a membership from another class and a membership from another teacher's class
 * all match zero rows and all produce the same sentence, so nothing about a
 * foreign membership can be read off the difference.
 */
export async function saveStandingNotes(
  classId: string,
  membershipId: string,
  formData: FormData,
) {
  const { supabase, classPath } = await authoriseRoster(classId, membershipId);

  const strengths = readSubmittedTags(formData, "strengths", "addStrength");

  if (!strengths.ok) {
    failTo(classPath, describeRejection(strengths, "điểm mạnh"));
  }

  const focusAreas = readSubmittedTags(formData, "focusAreas", "addFocusArea");

  if (!focusAreas.ok) {
    failTo(classPath, describeRejection(focusAreas, "nội dung cần cải thiện"));
  }

  const { data, error } = await supabase
    .from("class_members")
    // The only two columns written. `updated_at` moves on its own, through the
    // `set_updated_at` trigger the table already carries.
    .update({ strengths: strengths.tags, focus_areas: focusAreas.tags })
    .eq("id", membershipId)
    // Both ids, as every roster write does: a membership id from another class
    // — including one of this teacher's own — matches nothing.
    .eq("class_id", classId)
    .eq("join_status", "joined")
    .is("removed_at", null)
    .select("id");

  if (error) {
    logDbError("class_members.update(strengths, focus_areas)", error);
    failTo(classPath, "Chúng tôi chưa lưu được ghi chú. Vui lòng thử lại.");
  }

  if (!data || data.length === 0) {
    failTo(classPath, "Học viên này không còn trong danh sách lớp.");
  }

  // The student's own class page reads the same two columns off their own
  // membership row, so the breadth matches `setTargetBand`.
  revalidatePath("/teacher", "layout");
  redirect(classPath);
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
    "Học viên này không còn trong danh sách lớp.",
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
    "Lời mời này không còn ở trạng thái đang chờ.",
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
    failTo(classPath, "Chúng tôi chưa gửi được lời mời. Vui lòng thử lại.");
  }

  // No row, or a row with no address: a student invited by link alone has
  // nothing to send to.
  if (!member?.invited_email) {
    failTo(classPath, "Lời mời này không còn ở trạng thái đang chờ.");
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
    failTo(newPath, "Vui lòng chọn ngày cho buổi học này.");
  }

  const startTime = readText(formData, "start_time");
  const endTime = readText(formData, "end_time");

  if (!ISO_TIME.test(startTime) || !ISO_TIME.test(endTime)) {
    failTo(newPath, "Vui lòng nhập giờ bắt đầu và giờ kết thúc.");
  }

  const startsAt = instantOf(fields.timezone, date, startTime);
  const endsAt = instantOf(fields.timezone, date, endTime);

  // Mirrors `class_sessions_ends_after_starts`. A lesson running past midnight
  // would need a second date to express, which this form does not ask for, so
  // the two times are read on the one day the teacher chose.
  if (endsAt.getTime() <= startsAt.getTime()) {
    failTo(newPath, "Giờ kết thúc phải sau giờ bắt đầu.");
  }

  const title = readText(formData, "title");

  if (title.length > 200) {
    failTo(newPath, "Tên buổi học quá dài.");
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
      failTo(newPath, "Lớp này đã có một buổi học bắt đầu vào giờ đó.");
    }

    logDbError("class_sessions.insert", error);
    failTo(newPath, "Chúng tôi chưa lưu được buổi học này. Vui lòng thử lại.");
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
  courseType: CourseType;
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
    failTo(classPath, "Chúng tôi chưa tải được buổi học này. Vui lòng thử lại.");
  }

  // Built from a segment that has now been proved. Nothing submitted names a
  // destination, and nothing chooses between two of them: the workspace has one
  // canonical URL and it is under the calendar, so every action in this file
  // returns the teacher to the section they were in. See the note on
  // `app/teacher/calendar/session/[sessionId]/page.tsx` for why that is one
  // path rather than an origin-sensitive pair.
  return {
    supabase,
    teacherId,
    session: found.session,
    timezone: fields.timezone,
    // Which decides whether this class keeps bands at all — see
    // `scoringModelFor`. A proved value, not a submitted one.
    courseType: fields.courseType,
    sessionPath: `/teacher/calendar/session/${sessionId}`,
  };
}

/**
 * Marks one student present, late, absent or excused at one session.
 *
 * The whole chain is re-established here, in order, on every call:
 *
 *   authenticated user → teacher → owned class → session in that class
 *     → a session that has started → active member of that class
 *     → attendance for that (session, member)
 *
 * The fifth link is the newest and the only one that is about time rather than
 * ownership: `isAttendanceOpen(session.startsAt)`. It is enforced here and not
 * merely drawn on the page, because everything a page hides is still reachable
 * by POSTing to this function directly — the sheet being absent from the tab is
 * a convenience, this is the rule. See `lib/attendance.ts`, which is the one
 * copy of it, so the screen and the write cannot disagree.
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
  const { supabase, teacherId, session, timezone, sessionPath } =
    await authoriseSession(classId, sessionId);

  // The register does not open before the lesson does, and this is where that
  // is decided. `authoriseSession` has already returned the session row, so the
  // check costs nothing extra and reads the authoritative `starts_at` rather
  // than anything the request carried — there is no time, no date and no
  // "unlocked" flag anywhere on this form. A Server Function is a POST
  // endpoint: the page not drawing the sheet is a courtesy to the teacher, and
  // only this line is the rule. It sits after the whole ownership chain and
  // before the first write, so a caller who does not own the session still
  // learns nothing from it, and a caller who does simply cannot write early.
  if (!isAttendanceOpen(session.startsAt)) {
    failTo(
      sessionPath,
      `Điểm danh sẽ mở khi buổi học bắt đầu lúc ${formatZonedTime(
        timezone,
        session.startsAt,
      )}.`,
    );
  }

  if (!isUuid(membershipId)) {
    failTo(sessionPath, "Học viên này không còn trong danh sách lớp.");
  }

  const status = readText(formData, "status");

  if (!isAttendanceStatus(status)) {
    failTo(sessionPath, "Vui lòng chọn một trong các trạng thái điểm danh.");
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
    failTo(sessionPath, "Chúng tôi chưa lưu được điểm danh. Vui lòng thử lại.");
  }

  if (!member) {
    failTo(sessionPath, "Học viên này không còn trong danh sách lớp.");
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
    failTo(sessionPath, "Chúng tôi chưa lưu được điểm danh. Vui lòng thử lại.");
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
    failTo(sessionPath, "Vui lòng chọn học viên cho ghi chú này.");
  }

  const skill = readText(formData, "skill");

  if (!isSkill(skill)) {
    failTo(sessionPath, "Vui lòng chọn một kỹ năng.");
  }

  const performance = readText(formData, "performance");

  if (!isPerformance(performance)) {
    failTo(sessionPath, "Vui lòng chọn kết quả của học viên.");
  }

  // `readText` has already trimmed, which is what the CHECK measures: it is
  // `length(btrim(topic))`, so a topic of spaces is empty to the database too.
  const topic = readText(formData, "topic");

  if (topic.length === 0) {
    failTo(sessionPath, "Vui lòng cho biết nội dung buổi học.");
  }

  if (topic.length > TOPIC_MAX_LENGTH) {
    failTo(
      sessionPath,
      `Vui lòng nhập chủ đề không quá ${TOPIC_MAX_LENGTH} ký tự.`,
    );
  }

  const note = readText(formData, "note");

  if (note.length === 0) {
    failTo(sessionPath, "Vui lòng nhập nội dung ghi chú trước khi thêm.");
  }

  if (note.length > NOTE_MAX_LENGTH) {
    failTo(
      sessionPath,
      `Vui lòng nhập ghi chú không quá ${NOTE_MAX_LENGTH} ký tự.`,
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
    failTo(sessionPath, "Chúng tôi chưa lưu được ghi chú này. Vui lòng thử lại.");
  }

  if (!member) {
    failTo(sessionPath, "Học viên này không còn trong danh sách lớp.");
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
    failTo(sessionPath, "Chúng tôi chưa lưu được ghi chú này. Vui lòng thử lại.");
  }

  revalidatePath(sessionPath);
  redirect(sessionPath);
}

/**
 * Records one band entry for one student, dated to this lesson.
 *
 * The same chain as `createLessonLog`, re-established in the same order on
 * every call:
 *
 *   authenticated user → teacher → owned class → session in that class
 *     → active member of that class → a valid entry
 *
 * `score_entries` is where the milestone's wording and the schema part company,
 * and the schema wins. Three things about the table govern everything below:
 *
 *  1. There is no `session_id`. The table hangs off `class_members (id,
 *     class_id)` by composite foreign key and off a `recorded_on date` — it is a
 *     per-student band history, not a per-lesson score. So the lesson supplies
 *     the date and nothing else, and it supplies it the way `lesson_logs`
 *     already does: `zonedCalendarDate(timezone, session.startsAt)`, the day on
 *     the class's own clock rather than the server's or the browser's.
 *  2. It cannot be updated. `20260828001400_grants.sql` grants
 *     `select, insert, delete` and no UPDATE, and
 *     `enforce_score_entries_append_only` raises on any that slipped through.
 *     Correcting an entry is therefore `removeScoreEntry` followed by another
 *     of these — the path the table's own comment prescribes, and the one that
 *     leaves the history honest instead of silently rewritten.
 *  3. The audit column is `created_by`, not `recorded_by`. It comes from the
 *     session cookie here, as everywhere else.
 *
 * The only uniqueness the schema declares is
 * `score_entries_one_baseline_per_member`, one starting band per enrolment, and
 * a second one is answered in the application's own words rather than
 * Postgres's.
 */
export async function recordScoreEntry(
  classId: string,
  sessionId: string,
  formData: FormData,
): Promise<void> {
  const { supabase, teacherId, session, timezone, courseType, sessionPath } =
    await authoriseSession(classId, sessionId);

  // A class that is not scored has no bands to record — `isBandScored` is the
  // same rule the page renders by, and `classes_no_target_band_when_unscored`
  // is the schema saying it about the class's own target. Checked here too,
  // because a form that is not on screen can still be posted.
  if (!isBandScored(courseType)) {
    failTo(sessionPath, "Lớp này không ghi nhận band IELTS.");
  }

  const membershipId = readText(formData, "membershipId");
  const entryType = readText(formData, "entryType");
  const note = readText(formData, "note");

  if (!isUuid(membershipId)) {
    failTo(sessionPath, "Vui lòng chọn học viên để ghi nhận band.");
  }

  if (!isScoreEntryType(entryType)) {
    failTo(sessionPath, "Vui lòng chọn loại đánh giá.");
  }

  // Every band field read the way `public.band` would: in range, on a half
  // point, and blank meaning "not measured" rather than zero. Malformed input is
  // refused, never rounded into something nobody recorded.
  const bands: Record<string, number | null> = {};
  for (const field of ["overall", ...BAND_SKILLS]) {
    const result = readBand(readText(formData, field));
    if (!result.ok) {
      failTo(
        sessionPath,
        "Band phải là bội số của 0,5 trong khoảng từ 0.0 đến 9.0. Vui lòng kiểm tra lại.",
      );
    }
    bands[field] = result.band;
  }

  // `score_entries_not_empty`: `num_nonnulls(overall, reading, listening,
  // writing, speaking) > 0`. The schema's constraint, asked in front of it so
  // the answer is a sentence rather than a check violation.
  if (Object.values(bands).every((band) => band === null)) {
    failTo(sessionPath, "Vui lòng ghi nhận ít nhất một band.");
  }

  if (note.length > SCORE_NOTE_MAX_LENGTH) {
    failTo(
      sessionPath,
      `Vui lòng nhập ghi chú không quá ${SCORE_NOTE_MAX_LENGTH} ký tự.`,
    );
  }

  // This class's membership, and an active one — the same pair of facts
  // `recordAttendance` and `createLessonLog` re-establish. The composite foreign
  // key already refuses a member from another class; it knows nothing about
  // `removed_at`.
  const { data: member, error: memberError } = await supabase
    .from("class_members")
    .select("id")
    .eq("id", membershipId)
    .eq("class_id", classId)
    .eq("join_status", "joined")
    .is("removed_at", null)
    .maybeSingle();

  if (memberError) {
    logDbError("class_members.select(score entry)", memberError);
    failTo(sessionPath, "Chúng tôi chưa lưu được band điểm. Vui lòng thử lại.");
  }

  if (!member) {
    failTo(sessionPath, "Học viên này không còn trong danh sách lớp.");
  }

  // The day this lesson happened on, read on the class's clock. Never the
  // server's date, and never the browser's.
  const recordedOn = zonedCalendarDate(timezone, session.startsAt);

  // One entry per student per lesson date.
  //
  // Not a constraint the schema has, and said plainly: `score_entries` is an
  // append-only history and is perfectly willing to hold two entries for one
  // day. The reason is `v_member_current_band`, which picks the current band
  // with `order by recorded_on desc, id desc` — among entries sharing a date
  // that second key is a uuid, so two entries recorded at one lesson would make
  // "current band" the arbitrary one rather than the later one, and
  // `v_member_performance_status` would compare them in that same arbitrary
  // order. Refusing the second entry is how this page stays out of a tie it
  // cannot break; the correction path is the same as everywhere else here,
  // remove the entry and record it again.
  //
  // A read before a write is not a lock, so two teachers submitting at the same
  // instant could still both pass it. That leaves two honest rows and an
  // ambiguous "current", which the Remove control resolves — the same outcome
  // the database would give, and not a reason to invent a constraint the schema
  // does not have.
  const { data: existing, error: existingError } = await supabase
    .from("score_entries")
    .select("id")
    .eq("class_member_id", membershipId)
    .eq("class_id", classId)
    .eq("recorded_on", recordedOn)
    .limit(1);

  if (existingError) {
    logDbError("score_entries.select(existing)", existingError);
    failTo(sessionPath, "Chúng tôi chưa lưu được band điểm. Vui lòng thử lại.");
  }

  if (existing && existing.length > 0) {
    failTo(
      sessionPath,
      "Học viên này đã có một mục điểm cho buổi học này. Hãy xóa mục đó trước khi ghi nhận mục mới.",
    );
  }

  const { error } = await supabase.from("score_entries").insert({
    class_member_id: membershipId,
    // Half of the composite foreign key, and the proved segment rather than a
    // submitted value.
    class_id: classId,
    // The day this lesson happened on, read on the class's clock.
    recorded_on: recordedOn,
    entry_type: entryType,
    overall: bands.overall,
    reading: bands.reading,
    listening: bands.listening,
    writing: bands.writing,
    speaking: bands.speaking,
    note: note === "" ? null : note,
    // From the session cookie, never from the form.
    created_by: teacherId,
  });

  if (error) {
    // `score_entries_one_baseline_per_member` — the one uniqueness the schema
    // declares. Answered before the log, in the application's own words.
    if (error.code === "23505") {
      failTo(
        sessionPath,
        "Học viên này đã có band ban đầu. Hãy xóa mục đó trước nếu cần thay đổi.",
      );
    }
    logDbError("score_entries.insert", error);
    failTo(sessionPath, "Chúng tôi chưa lưu được band điểm. Vui lòng thử lại.");
  }

  revalidatePath(sessionPath);
  redirect(sessionPath);
}

/**
 * Deletes one band entry.
 *
 * The correction path, and the only one the schema offers: `score_entries` has
 * no UPDATE grant and a trigger that refuses one, so a wrong entry is removed
 * and recorded again rather than edited in place. That is the table's own
 * comment, and it is why this exists at all.
 *
 * The delete names both ids the relationship provides — `id` and `class_id` —
 * so an entry id belonging to another teacher's class matches no row rather
 * than being fetched and compared afterwards. `score_entries_teacher_all`
 * restricts the same statement to `app.my_class_ids()` underneath, and RLS is
 * forced on the table, so this filter agrees with the policy rather than
 * standing in for it.
 *
 * `.select("id")` is what makes "no such entry" distinguishable from "deleted":
 * a delete that matched nothing is not an error, and the teacher is owed the
 * difference.
 */
export async function removeScoreEntry(
  classId: string,
  sessionId: string,
  entryId: string,
): Promise<void> {
  const { supabase, sessionPath } = await authoriseSession(classId, sessionId);

  if (!isUuid(entryId)) {
    failTo(sessionPath, "Chúng tôi chưa xóa được mục điểm này. Vui lòng thử lại.");
  }

  const { data: removed, error } = await supabase
    .from("score_entries")
    .delete()
    .eq("id", entryId)
    .eq("class_id", classId)
    .select("id");

  if (error) {
    logDbError("score_entries.delete", error);
    failTo(sessionPath, "Chúng tôi chưa xóa được mục điểm này. Vui lòng thử lại.");
  }

  if (!removed || removed.length === 0) {
    failTo(sessionPath, "Mục điểm này đã được xóa.");
  }

  revalidatePath(sessionPath);
  redirect(sessionPath);
}

/* ==========================================================================
 * M30 — the session workspace: moving a lesson, setting homework, and
 * attaching curriculum material.
 *
 * Everything below goes through `authoriseClass` or `authoriseSession`, the two
 * gates the rest of this file already uses. Nothing new was invented for the
 * calendar: a drag ends in the same chain a click on the same session's page
 * would, and it ends there on the server.
 * ========================================================================== */

/**
 * The shape a calendar move reports back with.
 *
 * `null` is "nothing has been attempted", which is what `useActionState` starts
 * from. A message is a refusal the teacher can act on; success is silent,
 * because the revalidated grid showing the lesson on its new day is the
 * feedback, and a banner saying so would still be on screen a minute later.
 */
export type MoveResult = { error: string } | { ok: true } | null;

/**
 * Rewrites one session's start and end, on the class's own clock.
 *
 * The core both entry points share, so the drag on the calendar and the date
 * field on the session page cannot diverge — one validation, one conversion,
 * one statement, one set of error wording.
 *
 * ## Duration is carried in milliseconds, not recomputed from a wall clock
 *
 * `endsAt - startsAt` is an exact interval between two instants. Reading the
 * old end as "20:45" and re-applying it to the new date would instead give a
 * lesson a different length on the two days a year a zone changes offset. The
 * interval is what a teacher means by "the same lesson, a day later", so the
 * interval is what is preserved. `instantOf` resolves the new start on
 * `classes.timezone` — see `lib/time.ts` for why that is not `new Date(...)`.
 *
 * ## The one consequence worth knowing about
 *
 * `score_entries` has no `session_id`: §6 of the project's memory records that
 * "this lesson's entries" means entries whose `recorded_on` is the day the
 * lesson happened on. Attendance, lesson notes, homework and materials all hang
 * off `session_id` and follow the session wherever it goes; score entries do
 * not, so moving a session that already has marks recorded against its old date
 * leaves those marks on the old date. Nothing is deleted and nothing is
 * silently rewritten — a second table would have to be edited to "fix" it, and
 * guessing which entries belong to a lesson is exactly the derivation this
 * application keeps refusing to make.
 */
async function rescheduleSession(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string,
  session: ClassSession,
  timezone: string,
  date: string,
  startTime: string,
  durationMs: number,
): Promise<{ error: string } | { ok: true }> {
  const startsAt = instantOf(timezone, date, startTime);
  const endsAt = new Date(startsAt.getTime() + durationMs);

  // Mirrors `class_sessions_ends_after_starts`. Unreachable from a preserved
  // duration, which is always positive, but the shared core is also what the
  // edit form calls and that form can be given two times.
  if (endsAt.getTime() <= startsAt.getTime()) {
    return { error: "Giờ kết thúc phải sau giờ bắt đầu." };
  }

  const { data, error } = await supabase
    .from("class_sessions")
    .update({
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
    })
    .eq("id", session.sessionId)
    // The class is in the WHERE clause as well as the session, exactly as every
    // other write in this file has it: `class_sessions_teacher_all` is the
    // enforcement, and this is the statement agreeing with it rather than
    // relying on it alone.
    .eq("class_id", classId)
    .select("id");

  if (error) {
    // `class_sessions_class_starts_key` is unique over (class_id, starts_at).
    // Checking first would be a second query and a race; the constraint stays
    // the enforcement and this is only its wording.
    if (error.code === "23505") {
      return { error: "Lớp này đã có một buổi học bắt đầu vào giờ đó." };
    }

    logDbError("class_sessions.update(schedule)", error);
    return {
      error: "Chúng tôi chưa chuyển được buổi học này. Vui lòng thử lại.",
    };
  }

  if (!data || data.length === 0) {
    return { error: "Buổi học này không còn tồn tại. Vui lòng tải lại trang." };
  }

  return { ok: true };
}

/**
 * Moves one session to another slot on the grid — another day, another time of
 * day, or both — keeping its length.
 *
 * ## What a drag actually moves
 *
 * One `class_sessions` row, and nothing else. The milestone asks that a drag
 * "must not silently change a recurring schedule unless the model defines it
 * that way", so the model was read first: there is no recurring entity in this
 * schema at all. `classes.schedule_note` is free text the migration's own
 * comment labels display-only, and `class_sessions` is authoritative for when a
 * class actually meets. A block on the calendar is therefore exactly one
 * lesson, and moving it moves exactly that lesson. The schedule sentence on the
 * class is untouched, because it never generated these rows in the first place.
 *
 * ## The time comes off the grid, and the grid is a wall clock
 *
 * A drop now carries a start time as well as a date, because a calendar in
 * which vertical movement means nothing is a calendar that can only be used for
 * half of what it draws. The value is a `HH:MM` **wall clock on the class's own
 * timezone** — the grid's vertical axis is that clock and nothing else, so the
 * client sends minutes-past-midnight as text and `instantOf` does the one
 * conversion to an instant, exactly as the date-and-times form does. There is
 * no UTC arithmetic on either side of the wire, and the snapping the client
 * applies is a courtesy rather than a rule: any valid `HH:MM` is accepted here,
 * because the accessible form may send a time no grid would ever snap to and
 * the two paths must not disagree about what is legal.
 *
 * An absent time means "keep the one it has", which is what the milestone's
 * original date-only drag did and what a form that omits the field would mean.
 *
 * ## Why this one returns instead of redirecting
 *
 * Every other action in this file ends in `failTo(...)`, which redirects with
 * `?error=` in the query string. That is right for a page whose form the
 * teacher submitted and is looking at; it is wrong here. A drag is transient,
 * and a failure that writes itself into the URL survives the reload, the
 * bookmark and the Back button that follow it. So the refusal comes back as a
 * value, the client component renders it beside the grid, and the next
 * successful move clears it. The hard refusals still behave like the rest of
 * the file: `authoriseSession` calls `notFound()` for a class or a session this
 * teacher does not own, and those two are deliberately indistinguishable.
 *
 * ## The ids come off the form, and that is not a weakness
 *
 * A single hidden form serves every block on the grid, so `classId` and
 * `sessionId` arrive as submitted values rather than bound arguments. They
 * select a row; they do not grant one. `authoriseSession` re-derives the
 * teacher from the session cookie, resolves the class through
 * `loadEditableClass`'s `teacher_id` filter, and then finds the session with
 * both `id` and `class_id` in the WHERE clause — so a forged pair reaches a 404
 * before a date is read, and `class_sessions_teacher_all` refuses the statement
 * underneath even if it did not.
 *
 * There is no optimistic update anywhere in this path. The block does not move
 * until the server has written the row and the page has been revalidated, which
 * is what keeps the calendar from ever showing a lesson on a day the database
 * disagrees with.
 */
export async function moveSessionToSlot(
  _previous: MoveResult,
  formData: FormData,
): Promise<MoveResult> {
  const classId = readText(formData, "classId");
  const sessionId = readText(formData, "sessionId");

  // Shape only. Ownership is `authoriseSession`'s answer, one line down.
  if (!isUuid(classId) || !isUuid(sessionId)) {
    notFound();
  }

  const { supabase, session, timezone } = await authoriseSession(
    classId,
    sessionId,
  );

  const date = readCalendarDate(readText(formData, "date"));

  if (!date) {
    return { error: "Ngày không hợp lệ. Vui lòng thử lại." };
  }

  const wasOn = zonedCalendarDate(timezone, session.startsAt);
  const wasAt = formatZonedTime(timezone, session.startsAt);

  const submitted = readText(formData, "startTime");
  const startTime = submitted === "" ? wasAt : submitted;

  if (!ISO_TIME.test(startTime)) {
    return { error: "Giờ không hợp lệ. Vui lòng thử lại." };
  }

  // Dropped back on the slot it already occupies: a no-op, not a failure — and
  // not a write either. Both halves have to match, because either one alone can
  // now be the thing the drag changed. `HH:MM` against `HH:MM` is a string
  // comparison of two values `formatZonedTime` produced, so there is no
  // seconds-precision trap in it.
  if (wasOn === date && wasAt === startTime.slice(0, 5)) {
    return { ok: true };
  }

  const result = await rescheduleSession(
    supabase,
    classId,
    session,
    timezone,
    date,
    startTime,
    new Date(session.endsAt).getTime() - new Date(session.startsAt).getTime(),
  );

  if ("error" in result) return result;

  // The calendar, the class page's lesson list, the dashboard and the session's
  // own page all read this row. `"layout"` is what `createSession` already uses
  // for the same reason.
  revalidatePath("/teacher", "layout");
  return { ok: true };
}

/**
 * The keyboard's way to do what a drag does — and rather more.
 *
 * The milestone is explicit that "drag/drop must NOT be the only mechanism for
 * moving a session", so the session's own page carries a real form with a date
 * and two times. It is a plain `<form action={...}>` on a page reached by a
 * plain link, so it works with a keyboard, with a screen reader, and with
 * JavaScript disabled, none of which is true of a drag.
 *
 * Unlike the drag this one may change the times as well as the day, which is
 * why it takes both and computes the duration from them rather than preserving
 * the old one. It redirects like every other form action in this file, because
 * here the teacher submitted a form and is looking at the page it is on.
 */
export async function updateSessionSchedule(
  classId: string,
  sessionId: string,
  formData: FormData,
) {
  const { supabase, session, timezone, sessionPath } = await authoriseSession(
    classId,
    sessionId,
  );

  const date = readCalendarDate(readText(formData, "date"));

  if (!date) {
    failTo(sessionPath, "Vui lòng chọn ngày cho buổi học này.");
  }

  const startTime = readText(formData, "start_time");
  const endTime = readText(formData, "end_time");

  if (!ISO_TIME.test(startTime) || !ISO_TIME.test(endTime)) {
    failTo(sessionPath, "Vui lòng nhập giờ bắt đầu và giờ kết thúc.");
  }

  // Both times are read on the one day the teacher chose, exactly as
  // `createSession` reads them: a lesson running past midnight would need a
  // second date to express and this form does not ask for one.
  const duration =
    instantOf(timezone, date, endTime).getTime() -
    instantOf(timezone, date, startTime).getTime();

  const result = await rescheduleSession(
    supabase,
    classId,
    session,
    timezone,
    date,
    startTime,
    duration,
  );

  if ("error" in result) {
    failTo(sessionPath, result.error);
  }

  revalidatePath("/teacher", "layout");
  redirect(sessionPath);
}

/**
 * Sets one piece of homework against one session.
 *
 * ## Why this is not a new schema
 *
 * `homework_assignments` has carried a nullable `session_id` and the composite
 * `(session_id, class_id) references class_sessions (id, class_id)` since the
 * foundation commit, `homework_assignments_teacher_all` already scopes it to
 * `app.my_class_ids()`, and `20260828001400_grants.sql` already grants the
 * teacher every verb on it. `lib/student.ts` has been reading the pair since
 * M26. The only thing missing was the teacher's half, so that is all that was
 * added — no table, no column, no policy, no RPC.
 *
 * ## The submission rows are not optional
 *
 * `public.submit_homework(uuid)` — the one verb a student gets, and the only
 * way a submission can ever be recorded — looks the row up with `select ...
 * for update` and raises `42501` when it finds none. An assignment created
 * without its submission rows would therefore be an assignment no student could
 * ever hand in. Creating them is the schema's own definition of "assigned", not
 * a convenience: `homework_status` defaults to `'assigned'` and the status
 * invariant makes that the only state with no timestamps, which is exactly a
 * piece of work that has been set and not yet done.
 *
 * They are inserted for the class's *active* members — `join_status = 'joined'`
 * and `removed_at is null` — the same pair `loadSessionAttendance` and
 * `app.my_student_class_ids()` use. An unclaimed invitation is not somebody who
 * can hand work in.
 *
 * ## assigned_on is the lesson's own day
 *
 * Not `current_date`, which is what the column defaults to and would be wrong
 * for a teacher writing up Tuesday's lesson on Thursday. It is
 * `zonedCalendarDate(timezone, session.startsAt)` — the day the lesson happened
 * on, on the class's clock — which is also what makes
 * `homework_assignments_due_after_assigned` mean what a teacher expects.
 */
export async function createHomework(
  classId: string,
  sessionId: string,
  formData: FormData,
) {
  const { supabase, teacherId, session, timezone, sessionPath } =
    await authoriseSession(classId, sessionId);

  const failPath = `${sessionPath}?tab=homework`;

  const title = readText(formData, "title");

  // `homework_assignments_title_length` is 1–300 on the trimmed value. This is
  // the same rule said in Vietnamese before the round trip.
  if (title.length === 0) {
    failTo(failPath, "Vui lòng nhập tên bài tập.");
  }
  if (title.length > 300) {
    failTo(failPath, "Tên bài tập quá dài.");
  }

  const skill = readText(formData, "skill");

  if (!isSkill(skill)) {
    failTo(failPath, "Vui lòng chọn kỹ năng cho bài tập này.");
  }

  const description = readText(formData, "description");

  if (description.length > NOTE_MAX_LENGTH) {
    failTo(failPath, "Mô tả bài tập quá dài.");
  }

  // The day the lesson was taught, on the class's clock — never the server's.
  const assignedOn = zonedCalendarDate(timezone, session.startsAt);

  const rawDue = readText(formData, "due_date");
  let dueDate: string | null = null;

  if (rawDue !== "") {
    dueDate = readCalendarDate(rawDue);
    if (!dueDate) {
      failTo(failPath, "Hạn nộp không hợp lệ.");
    }
    // Mirrors `homework_assignments_due_after_assigned`. Both are `YYYY-MM-DD`
    // and compare as strings; no `Date` is constructed to decide it.
    if (dueDate < assignedOn) {
      failTo(failPath, "Hạn nộp phải sau ngày giao bài.");
    }
  }

  const rawMax = readText(formData, "max_score");
  // `numeric(4, 1)` and `max_score > 0`, so at most 999.9 and never zero.
  const maxScore = rawMax === "" ? 10 : Number(rawMax);

  if (!Number.isFinite(maxScore) || maxScore <= 0 || maxScore > 999.9) {
    failTo(failPath, "Điểm tối đa không hợp lệ.");
  }

  const { data: created, error } = await supabase
    .from("homework_assignments")
    .insert({
      // Neither id comes from the form: both were proved by `authoriseSession`.
      class_id: classId,
      session_id: sessionId,
      title,
      description: description === "" ? null : description,
      skill,
      assigned_on: assignedOn,
      due_date: dueDate,
      max_score: maxScore,
      // Derived from the session cookie in `authoriseClass`, never submitted.
      created_by: teacherId,
    })
    .select("id")
    .maybeSingle();

  if (error || !created) {
    if (error) logDbError("homework_assignments.insert", error);
    failTo(failPath, "Chúng tôi chưa lưu được bài tập này. Vui lòng thử lại.");
  }

  const { data: members, error: rosterError } = await supabase
    .from("class_members")
    .select("id")
    .eq("class_id", classId)
    .eq("join_status", "joined")
    .is("removed_at", null);

  if (rosterError) {
    logDbError("class_members.select(homework)", rosterError);
    // The assignment exists and the teacher can see it; what failed is the
    // fan-out. Said plainly rather than pretended away, because a student who
    // has no submission row cannot hand the work in.
    failTo(
      failPath,
      "Đã lưu bài tập, nhưng chưa giao được cho học viên. Vui lòng xóa và tạo lại.",
    );
  }

  if (members && members.length > 0) {
    const { error: fanOutError } = await supabase
      .from("homework_submissions")
      .insert(
        members.map((member) => ({
          assignment_id: created.id,
          class_member_id: member.id,
          class_id: classId,
        })),
      );

    if (fanOutError) {
      logDbError("homework_submissions.insert", fanOutError);
      failTo(
        failPath,
        "Đã lưu bài tập, nhưng chưa giao được cho học viên. Vui lòng xóa và tạo lại.",
      );
    }
  }

  revalidatePath("/teacher", "layout");
  redirect(failPath);
}

/**
 * Withdraws one assignment from one session.
 *
 * A real DELETE rather than the soft removal a membership gets, because nothing
 * outside this assignment depends on it: `homework_submissions_assignment_fk`
 * is `on delete cascade`, so the submissions go with it, and no other table
 * references either. A membership is the opposite — six composite keys cascade
 * from it — which is why that one is `removed_at` and this one is not.
 *
 * Scoped by session as well as class, so an assignment id from another lesson
 * of the same class matches nothing here either. `.select("id")` is what makes
 * "already gone" distinguishable from "deleted".
 */
export async function removeHomework(
  classId: string,
  sessionId: string,
  assignmentId: string,
) {
  const { supabase, sessionPath } = await authoriseSession(classId, sessionId);
  const failPath = `${sessionPath}?tab=homework`;

  if (!isUuid(assignmentId)) {
    failTo(failPath, "Bài tập này không còn tồn tại.");
  }

  const { data, error } = await supabase
    .from("homework_assignments")
    .delete()
    .eq("id", assignmentId)
    .eq("class_id", classId)
    .eq("session_id", sessionId)
    .select("id");

  if (error) {
    logDbError("homework_assignments.delete", error);
    failTo(failPath, "Chúng tôi chưa xóa được bài tập này. Vui lòng thử lại.");
  }

  if (!data || data.length === 0) {
    failTo(failPath, "Bài tập này đã được xóa.");
  }

  revalidatePath("/teacher", "layout");
  redirect(failPath);
}

/**
 * Attaches one curriculum file to one session.
 *
 * ## This is the one part of M30 with no existing mechanism to reuse
 *
 * The audit looked for a bucket, an upload helper, a metadata table and a
 * download route, and found none — a read-only `select ... from
 * storage.buckets` against the project returned an empty list. So
 * `supabase/migrations/20260901000100_class_materials.sql` proposes the
 * smallest secure design consistent with the rest of the schema, and it is
 * **not applied**: until a human runs it every statement here fails and the tab
 * says so. Nothing creates the bucket or the table on demand.
 *
 * ## Where the security actually lives
 *
 * Not in this function. The bucket is private, so an object URL is not a
 * capability; the upload runs on the server as the signed-in teacher, so
 * `class_materials_objects_teacher_insert` compares the path's first segment
 * against `app.my_class_ids()` and refuses a class this teacher does not own
 * whatever the application asks for; and `class_materials_teacher_all` refuses
 * the metadata row on the same basis. There is no service-role key in this
 * path, no client-side Supabase call, and no place a browser could put a class
 * id that is not re-proved by `authoriseSession` first.
 *
 * ## The filename is never a path
 *
 * `materialStoragePath` builds `<class_id>/<uuid>`. A filename is untrusted
 * text — it can hold separators, `..`, control characters, or simply collide —
 * and none of that can matter if it never becomes a path component. The real
 * name is a column, and the download route hands it back through the signed
 * URL's `Content-Disposition`.
 *
 * ## Order of operations
 *
 * Object first, row second, and the object is removed again if the row fails.
 * The other order would leave a row pointing at bytes that do not exist, which
 * the teacher would see as a file that will not download. This order leaves at
 * worst an object nothing references, which nobody sees at all.
 */
export async function uploadMaterial(
  classId: string,
  sessionId: string,
  formData: FormData,
) {
  const { supabase, teacherId, sessionPath } = await authoriseSession(
    classId,
    sessionId,
  );

  const failPath = `${sessionPath}?tab=materials`;
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    failTo(failPath, "Vui lòng chọn một tệp giáo trình.");
  }

  if (file.size > MAX_MATERIAL_BYTES) {
    failTo(failPath, "Tệp vượt quá 25 MB.");
  }

  const fileName = file.name.trim();

  // `class_materials_file_name_length` is 1–300 on the trimmed value.
  if (fileName.length === 0 || fileName.length > 300) {
    failTo(failPath, "Tên tệp không hợp lệ.");
  }

  // Said here in Vietnamese before an upload is spent on it; the bucket's own
  // `allowed_mime_types` is the check that actually holds.
  if (!isAllowedMaterial(file.type, fileName)) {
    failTo(
      failPath,
      "Chỉ hỗ trợ tệp PDF, Word, Excel và PowerPoint.",
    );
  }

  const storagePath = materialStoragePath(classId);

  const { error: uploadError } = await supabase.storage
    .from(MATERIALS_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type,
      // A fresh uuid cannot collide, and refusing an overwrite is what keeps a
      // row and the bytes it names from ever being swapped underneath it.
      upsert: false,
    });

  if (uploadError) {
    console.error("[teacher] class-materials upload failed", {
      message: uploadError.message,
    });
    failTo(failPath, "Chúng tôi chưa tải lên được tệp này. Vui lòng thử lại.");
  }

  const { error } = await supabase.from("class_materials").insert({
    class_id: classId,
    session_id: sessionId,
    storage_path: storagePath,
    file_name: fileName,
    mime_type: file.type,
    byte_size: file.size,
    uploaded_by: teacherId,
  });

  if (error) {
    logDbError("class_materials.insert", error);
    // Compensate, so the bucket does not accumulate bytes nothing points at.
    await supabase.storage.from(MATERIALS_BUCKET).remove([storagePath]);
    failTo(failPath, "Chúng tôi chưa lưu được tệp này. Vui lòng thử lại.");
  }

  revalidatePath("/teacher", "layout");
  redirect(failPath);
}

/**
 * Removes one material — the row and the bytes.
 *
 * The row is read first, scoped to the class and the session, so the path that
 * gets deleted comes from the database rather than from the request. A path
 * submitted by a browser would make the object store's policies the only check
 * standing between a teacher and another teacher's file; making the row the
 * lookup means there are two, and the first one is this application's.
 *
 * The object goes first and the row second. If the object delete fails the row
 * stays, so the teacher still sees the file and can try again; the other order
 * would hide a file that still exists.
 */
export async function removeMaterial(
  classId: string,
  sessionId: string,
  materialId: string,
) {
  const { supabase, sessionPath } = await authoriseSession(classId, sessionId);
  const failPath = `${sessionPath}?tab=materials`;

  if (!isUuid(materialId)) {
    failTo(failPath, "Tệp này không còn tồn tại.");
  }

  const material = await loadMaterial(supabase, classId, materialId);

  if (!material) {
    failTo(failPath, "Tệp này đã được xóa.");
  }

  const { error: removeError } = await supabase.storage
    .from(MATERIALS_BUCKET)
    .remove([material.storagePath]);

  if (removeError) {
    console.error("[teacher] class-materials remove failed", {
      message: removeError.message,
    });
    failTo(failPath, "Chúng tôi chưa xóa được tệp này. Vui lòng thử lại.");
  }

  const { error } = await supabase
    .from("class_materials")
    .delete()
    .eq("id", materialId)
    .eq("class_id", classId)
    .eq("session_id", sessionId);

  if (error) {
    logDbError("class_materials.delete", error);
    failTo(failPath, "Chúng tôi chưa xóa được tệp này. Vui lòng thử lại.");
  }

  revalidatePath("/teacher", "layout");
  redirect(failPath);
}
