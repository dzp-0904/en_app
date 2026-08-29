"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import {
  isOfferedCourseType,
  scoringModelFor,
  targetBandFor,
  type OfferedCourseType,
  type ScoringModel,
} from "@/lib/course-type";
import { invitationEmail } from "@/lib/mail/invitation-email";
import { MailNotConfiguredError, sendMail } from "@/lib/mail/mailer";
import { requireTeacher } from "@/lib/onboarding";
import { isUuid, loadEditableClass, loadInviteCode } from "@/lib/teacher";
import { joinUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

/**
 * Onboarding Server Actions, plus the two that write a class.
 *
 * `createClass` and `updateClass` live here rather than in a module of their
 * own because they are the same form reaching the same table under the same
 * rules: one `readClassFields` decides what a valid class looks like, and both
 * write what it returns. Splitting them across two files would put those rules
 * one import away from a second copy.
 *
 * Same shape as the auth actions, for the same reasons: plain `formData`
 * handlers so the forms submit without JavaScript, each one re-establishing the
 * caller's identity through `requireTeacher()` rather than trusting anything the
 * page or the proxy did. A Server Function is a POST endpoint — the fact that
 * the only link to it sits behind a guarded page is not a guard.
 *
 * Failures redirect back with `?error=`, which keeps every step a Server
 * Component. The messages are written for the teacher; the PostgreSQL error is
 * logged, never shown, because its text can name columns, constraints and
 * policies.
 */

const NAME_STEP = "/onboarding/name";
const TEACHING_TYPE_STEP = "/onboarding/teaching-type";
const CLASS_STEP = "/onboarding/class";
const INVITE_STEP = "/onboarding/invite";

/** The same form as `CLASS_STEP`, outside the wizard. See `createClass`. */
const NEW_CLASS_PAGE = "/teacher/new";

/** Redirects with a message attached. Returns `never` so callers narrow. */
function failTo(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

/** Records a database failure for the operator without echoing it to the user. */
function logDbError(
  operation: string,
  error: { code?: string; message?: string; details?: string | null },
): void {
  console.error(`[onboarding] ${operation} failed`, {
    code: error.code,
    message: error.message,
    details: error.details ?? undefined,
  });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Accepts what `<input type="date">` submits.
 *
 * The round-trip through `Date` rejects the impossible dates a hand-typed value
 * or a non-supporting browser can produce — 2026-02-31 parses but normalises to
 * March, so comparing the formatted result catches it.
 */
function readDate(raw: string): string | null {
  if (!ISO_DATE.test(raw)) return null;

  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString().slice(0, 10) === raw ? raw : null;
}

/** Step 1 — the teacher's display name. */
export async function saveName(formData: FormData) {
  const teacher = await requireTeacher();

  const fullName = String(formData.get("full_name") ?? "").trim();

  if (!fullName) {
    failTo(NAME_STEP, "Enter the name your students should see.");
  }

  // profiles_full_name_length allows 1..120.
  if (fullName.length > 120) {
    failTo(NAME_STEP, "Please use a name of 120 characters or fewer.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName })
    .eq("id", teacher.userId);

  if (error) {
    logDbError("saveName", error);
    failTo(NAME_STEP, "We could not save your name. Please try again.");
  }

  revalidatePath("/onboarding", "layout");
  redirect(TEACHING_TYPE_STEP);
}

/** Step 2 — what the teacher primarily teaches. */
export async function saveTeachingType(formData: FormData) {
  const teacher = await requireTeacher();

  const teachingType = String(formData.get("teaching_type") ?? "").trim();

  if (!isOfferedCourseType(teachingType)) {
    failTo(TEACHING_TYPE_STEP, "Choose what you primarily teach.");
  }

  const supabase = await createClient();

  // profiles_teaching_type_teacher_only permits a non-null value only when
  // role = 'teacher', which requireTeacher() has already established.
  const { error } = await supabase
    .from("profiles")
    .update({ teaching_type: teachingType })
    .eq("id", teacher.userId);

  if (error) {
    logDbError("saveTeachingType", error);
    failTo(
      TEACHING_TYPE_STEP,
      "We could not save your choice. Please try again.",
    );
  }

  revalidatePath("/onboarding", "layout");
  redirect(CLASS_STEP);
}

/**
 * Creates the invite code row for a new class.
 *
 * `generate_invite_code` only returns a string — it writes nothing — so the row
 * is inserted here. A collision on `class_invite_codes_code_key` is vanishingly
 * unlikely at 12 characters over a 30-symbol alphabet (~59 bits), but a unique
 * index exists precisely so that the improbable case is an error rather than a
 * shared code, and the retry turns that error into a new draw.
 */
async function createInviteCode(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string,
): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: code, error: generateError } = await supabase.rpc(
      "generate_invite_code",
      { p_length: 12 },
    );

    if (generateError || !code) {
      logDbError("generate_invite_code", generateError ?? {});
      return null;
    }

    const { error: insertError } = await supabase
      .from("class_invite_codes")
      .insert({ class_id: classId, code });

    if (!insertError) return code;

    // 23505 = unique violation. Anything else is not worth re-drawing for.
    if (insertError.code !== "23505") {
      logDbError("class_invite_codes.insert", insertError);
      return null;
    }
  }

  console.error("[onboarding] invite code generation collided three times", {
    classId,
  });
  return null;
}

/**
 * The columns `ClassForm` is responsible for, once validated.
 *
 * A row rather than a handful of loose variables, so `createClass` and
 * `updateClass` cannot disagree about which columns the form owns. Everything
 * else `classes` holds — `teacher_id`, `description`, `timezone`,
 * `default_tuition_rate_per_session`, `archived_at`, and the timestamps the
 * `set_updated_at` trigger maintains — is absent from this shape on purpose, so
 * an update built from it leaves all of them exactly as they were.
 *
 * `course_type_other` is pinned to null rather than omitted.
 * `classes_course_type_other_required` requires
 * `(course_type = 'other') = (course_type_other is not null)`, and `COURSE_TYPES`
 * never offers `other`, so null is the only value consistent with anything this
 * form can submit. Omitting it would leave a stale custom name behind on an
 * update and break the constraint.
 */
type ClassFields = {
  name: string;
  course_type: OfferedCourseType;
  course_type_other: null;
  scoring_model: ScoringModel;
  target_band: number | null;
  start_date: string;
  end_date: string | null;
  schedule_note: string | null;
};

/**
 * Reads and validates a submitted class form, or sends the teacher back to it.
 *
 * The one description of what a valid class looks like. Creating and editing
 * ask the same questions of the same table under the same CHECK constraints, so
 * a second copy of these rules would be a second place for them to fall out of
 * step with the schema — and the half that drifted would be found by a
 * constraint violation in production rather than here.
 *
 * `formPath` is where a mistake returns to, and it is always a literal the
 * server chose: the wizard step, `/teacher/new`, or the edit page for a class
 * ownership has already been established on. Nothing on the form can name it.
 *
 * Returns `ClassFields` or does not return at all — `failTo` redirects — which
 * is what lets callers use the result without narrowing it first.
 */
function readClassFields(formData: FormData, formPath: string): ClassFields {
  const name = String(formData.get("name") ?? "").trim();
  const courseTypeRaw = String(formData.get("course_type") ?? "").trim();
  const targetBandRaw = String(formData.get("target_band") ?? "").trim();
  const startDateRaw = String(formData.get("start_date") ?? "").trim();
  const endDateRaw = String(formData.get("end_date") ?? "").trim();
  const scheduleNote = String(formData.get("schedule_note") ?? "").trim();

  if (!name) {
    failTo(formPath, "Give the class a name.");
  }

  // classes_name_length allows 1..200.
  if (name.length > 200) {
    failTo(formPath, "Please use a class name of 200 characters or fewer.");
  }

  if (!isOfferedCourseType(courseTypeRaw)) {
    failTo(formPath, "Choose a course type.");
  }
  const courseType = courseTypeRaw;

  if (!startDateRaw) {
    failTo(formPath, "Choose a start date.");
  }

  const startDate = readDate(startDateRaw);
  if (!startDate) {
    failTo(formPath, "That start date is not a real date.");
  }

  // Absent is meaningful, not missing: clearing the field is how a teacher
  // makes a class open-ended, and that has to be writable on an edit.
  let endDate: string | null = null;
  if (endDateRaw) {
    endDate = readDate(endDateRaw);
    if (!endDate) {
      failTo(formPath, "That end date is not a real date.");
    }

    // classes_end_after_start. Checked here so the teacher sees which field is
    // wrong instead of a constraint failure.
    if (endDate < startDate) {
      failTo(formPath, "The end date cannot be before the start date.");
    }
  }

  return {
    name,
    course_type: courseType,
    // Derived, never submitted: these three have to satisfy
    // classes_no_target_band_when_unscored and
    // classes_course_type_other_required together, and only the server can be
    // trusted to keep them consistent.
    course_type_other: null,
    scoring_model: scoringModelFor(courseType),
    target_band: targetBandFor(courseType, targetBandRaw || null),
    start_date: startDate,
    end_date: endDate,
    schedule_note: scheduleNote || null,
  };
}

/**
 * Creates a class, plus the invite code its students will use.
 *
 * This is step 3 of the wizard and it is also how a teacher adds their second
 * class from `/teacher`. One action, because the two differ only in where the
 * teacher goes afterwards — the row written, the validation applied and the
 * ownership established are identical, and a second insertion path would be a
 * second place for `classes`' CHECK constraints to be got wrong.
 *
 * That destination is derived from `teacher.currentClass`, which `requireTeacher`
 * read from the database *before* this insert: no class yet means this is the
 * first one and the wizard continues to the invite step; an existing class means
 * this is everyday work and the teacher goes straight to the new class. The
 * signal is a row, never a field on the form, so a submission cannot choose
 * where it redirects to.
 */
export async function createClass(formData: FormData) {
  const teacher = await requireTeacher();

  // Whichever form was submitted is the one a mistake must return to, or the
  // teacher loses what they typed and lands in a wizard they finished long ago.
  const formPath = teacher.currentClass ? NEW_CLASS_PAGE : CLASS_STEP;

  const fields = readClassFields(formData, formPath);

  const supabase = await createClient();

  const { data: created, error } = await supabase
    .from("classes")
    // The one column the form does not supply, and the one that must not come
    // from it: ownership is the authenticated user, full stop.
    .insert({ teacher_id: teacher.userId, ...fields })
    .select("id")
    .single();

  if (error || !created) {
    logDbError("classes.insert", error ?? {});
    failTo(formPath, "We could not create the class. Please try again.");
  }

  const code = await createInviteCode(supabase, created.id);

  // A later class: the teacher goes to the class itself, which is both the
  // confirmation that it exists and the page they were heading for anyway.
  if (teacher.currentClass) {
    // The list and the new detail page are both rendered per request, but the
    // client router caches them across a redirect; without this the teacher can
    // navigate back to a `/teacher` that is missing the class they just made.
    revalidatePath("/teacher", "layout");

    // No error parameter when the code is missing: `/teacher/[classId]` already
    // reports that the class has no invitation link yet and to refresh, which is
    // the whole of what went wrong and is truer than an alert on a page that
    // otherwise shows a class created successfully.
    redirect(`/teacher/${created.id}`);
  }

  if (!code) {
    // The first class exists and is usable; only the shareable link is missing.
    // Say so rather than implying the whole step failed.
    failTo(
      INVITE_STEP,
      "The class was created, but we could not generate its invitation link. Please try again shortly.",
    );
  }

  revalidatePath("/onboarding", "layout");
  redirect(INVITE_STEP);
}

/**
 * Edits a class the teacher already owns.
 *
 * The counterpart to `createClass`, and deliberately the same shape: the same
 * `readClassFields`, so the two write identical columns under identical rules,
 * and the same refusal to take anything load-bearing off the form.
 *
 * `classId` is a bound argument, not a form field — the edit page supplies it
 * from the URL segment it already rendered. That is not what authorises the
 * write, and it is not treated as if it were. The filter below is
 *
 *   .eq("id", classId).eq("teacher_id", teacher.userId)
 *
 * so a class belonging to somebody else matches nothing and updates nothing,
 * exactly as it reads nothing in `loadEditableClass`. Underneath that,
 * `classes_teacher_all`'s WITH CHECK refuses the statement outright unless
 * `teacher_id = auth.uid()` and `app.is_teacher()`. Three independent reasons
 * this cannot touch another teacher's row; the URL is none of them.
 *
 * Nothing outside `classes` is written. The invitation code lives in
 * `class_invite_codes` and is never read here, so an edit cannot rotate or
 * revoke it; the roster lives in `class_members` and is likewise untouched. A
 * student's view of the class updates because they were always reading the same
 * row, not because anything of theirs was rewritten.
 */
export async function updateClass(classId: string, formData: FormData) {
  const teacher = await requireTeacher();

  // A segment that cannot name a class is a wrong link, not a server fault, and
  // it is rejected before PostgREST can turn it into `22P02`.
  if (!isUuid(classId)) {
    notFound();
  }

  // Built from the segment the page was rendered at, never from a `return_to`
  // or any other submitted field: a Server Function is a POST endpoint, and an
  // attacker-chosen redirect target is exactly what one should not accept.
  const editPath = `/teacher/${classId}/edit`;
  const fields = readClassFields(formData, editPath);

  const supabase = await createClient();

  const { data: updated, error } = await supabase
    .from("classes")
    .update(fields)
    .eq("id", classId)
    .eq("teacher_id", teacher.userId)
    // Archiving is not this milestone's to undo; an archived class is not
    // visible anywhere in the teacher UI, so it is not editable either.
    .is("archived_at", null)
    .select("id");

  if (error) {
    logDbError("classes.update", error);
    failTo(editPath, "We could not save your changes. Please try again.");
  }

  // Zero rows means the class is not this teacher's — or is archived, or is
  // gone. Answered as "not found", the same way `loadEditableClass` answers it,
  // so a failed update says nothing about whose class it was.
  if (!updated || updated.length === 0) {
    notFound();
  }

  // The list, the detail page and the edit form are all rendered per request,
  // but the client router caches them across the redirect; without this the
  // teacher can navigate back to a `/teacher` still showing the old name.
  revalidatePath("/teacher", "layout");
  redirect(`/teacher/${classId}`);
}

/**
 * Which page rendered the invitation form.
 *
 * Not a path. A Server Function is a POST endpoint, so the destination it
 * redirects to must never be something a submission can state, and the safest
 * way to guarantee that is for no destination to cross the wire at all — the
 * action builds both from `classId` itself. This discriminator only picks
 * which of the two it builds.
 */
type InviteOrigin = "onboarding" | "class";

/**
 * Invite one student by email, to one named class.
 *
 * Used by the wizard's last step and by `/teacher/[classId]`, which is the point
 * of the change: this used to read `teacher.currentClass` — the teacher's most
 * recent class — so it could only ever invite into whichever class was newest,
 * and a teacher wanting to add a student to an older one had no way to say so.
 * The class is now named by the caller and checked against the caller's
 * identity, exactly as `updateClass` does it.
 *
 * `classId` is a bound argument, not a form field, and it is not what authorises
 * anything. `loadEditableClass` re-reads the class filtered by
 * `teacher_id = <authenticated user>`, so a class belonging to somebody else is
 * indistinguishable from one that does not exist, and beneath that
 * `class_invite_codes_teacher_all` refuses to hand out a code for a class that
 * is not in `app.my_class_ids()`. The URL selects a row; it does not grant one.
 *
 * Order matters. The roster row is written first and the message is sent second,
 * because the row is what actually grants the invitation: `join_class_with_code`
 * claims a pending row by matching the joiner's *verified* address, so a student
 * who never receives the email can still be let in with the link. Sending first
 * and failing to record would produce the opposite — a promise with nothing
 * behind it.
 *
 * If the send fails the row is deliberately kept, and the page reports that the
 * invitation is saved but the email did not go out. `invite_email_sent_at` is
 * stamped only on a confirmed send, so the UI never claims delivery that did not
 * happen.
 */
export async function inviteStudentByEmail(
  classId: string,
  origin: InviteOrigin,
  formData: FormData,
) {
  const teacher = await requireTeacher();

  if (!isUuid(classId)) {
    notFound();
  }

  // Built from the bound segment and a two-valued discriminator, never from the
  // submission. See `InviteOrigin`.
  const formPath =
    origin === "onboarding" ? INVITE_STEP : `/teacher/${classId}`;

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (!email) {
    failTo(formPath, "Enter a student's email address.");
  }

  // Deliberately loose: one @, no spaces, a dot in the domain. Anything
  // stricter rejects addresses that are valid, and the real test is whether the
  // student can confirm the address at sign-up.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    failTo(formPath, "That does not look like an email address.");
  }

  const supabase = await createClient();

  // The ownership check, and where the class name in the email comes from. The
  // same loader the edit page uses, so there is one answer to "may this teacher
  // touch this class" rather than one per feature.
  const owned = await loadEditableClass(supabase, teacher.userId, classId);

  if (owned.kind === "not-found") {
    notFound();
  }

  if (owned.kind === "error") {
    // A failed read is not "no such class": telling a teacher their class is
    // gone when the database stumbled is the worse of the two answers.
    failTo(formPath, "We could not load this class. Please try again.");
  }

  // The same four rules `/join/[code]` will apply to whatever we send. A code
  // that is active but expired or exhausted is not a link worth emailing.
  const code = await loadInviteCode(supabase, classId);

  if (!code) {
    failTo(
      formPath,
      "This class has no active invitation link, so we cannot invite anyone yet.",
    );
  }

  // class_members_class_invited_email_key makes (class_id, invited_email)
  // unique among rows that have not been removed, so a repeat submission is a
  // resend rather than a second invitation.
  const { data: existing, error: existingError } = await supabase
    .from("class_members")
    .select("id, join_status, invite_email_sent_at")
    .eq("class_id", classId)
    .eq("invited_email", email)
    .is("removed_at", null)
    .maybeSingle();

  if (existingError) {
    logDbError("class_members.select", existingError);
    failTo(formPath, "We could not check the class list. Please try again.");
  }

  if (existing?.join_status === "joined") {
    failTo(formPath, "That student has already joined this class.");
  }

  let memberId = existing?.id ?? null;

  if (!memberId) {
    const { data: inserted, error: insertError } = await supabase
      .from("class_members")
      .insert({
        class_id: classId,
        invited_email: email,
        join_status: "invited",
        invited_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    // 23505 means a concurrent submission won the race; that row is the
    // invitation, so carry on and let the send stamp it.
    if (insertError && insertError.code !== "23505") {
      logDbError("class_members.insert", insertError);
      failTo(
        formPath,
        "We could not add that student to the class. Please try again.",
      );
    }

    memberId = inserted?.id ?? null;
  }

  const url = await joinUrl(code);

  try {
    await sendMail(
      invitationEmail(email, {
        className: owned.fields.className,
        teacherName: teacher.fullName,
        joinUrl: url,
      }),
    );
  } catch (cause) {
    // Never log the error object wholesale: nodemailer attaches the transport
    // options, which carry the SMTP password.
    console.error("[onboarding] invitation email failed", {
      classId,
      reason:
        cause instanceof MailNotConfiguredError
          ? cause.message
          : cause instanceof Error
            ? cause.name
            : "unknown",
    });

    revalidateFor(origin);
    // Worded for both callers. `resendInvitation` reaches this line too, and
    // "was added to the class" would be untrue of somebody who was already on
    // the list before the button was pressed.
    failTo(
      formPath,
      `We could not send the email to ${email}. Their invitation is saved — share the invitation link with them instead.`,
    );
  }

  if (memberId) {
    const { error: stampError } = await supabase
      .from("class_members")
      .update({ invite_email_sent_at: new Date().toISOString() })
      .eq("id", memberId);

    if (stampError) {
      // The message did go out, so this is a bookkeeping problem, not a
      // failure to report to the teacher.
      logDbError("class_members.update(invite_email_sent_at)", stampError);
    }
  }

  // No success parameter: the invitation list on both pages is read back from
  // class_members, so it is the confirmation, and it stays correct on a reload.
  revalidateFor(origin);
  redirect(formPath);
}

/**
 * Drops the cached render of whichever tree the invitation form lives in.
 *
 * Both pages are rendered per request, but the client router caches them across
 * the redirect, so without this the teacher is returned to a page still listing
 * the invitations it had before theirs. `/teacher` is invalidated as a layout
 * because the class list shows a pending count that has just changed too.
 */
function revalidateFor(origin: InviteOrigin): void {
  revalidatePath(origin === "onboarding" ? "/onboarding" : "/teacher", "layout");
}
