"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  isOfferedCourseType,
  scoringModelFor,
  targetBandFor,
} from "@/lib/course-type";
import { invitationEmail } from "@/lib/mail/invitation-email";
import { MailNotConfiguredError, sendMail } from "@/lib/mail/mailer";
import { requireTeacher } from "@/lib/onboarding";
import { joinUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

/**
 * Onboarding Server Actions.
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

/** Step 3 — the first class, plus the invite code students will use. */
export async function createFirstClass(formData: FormData) {
  const teacher = await requireTeacher();

  const name = String(formData.get("name") ?? "").trim();
  const courseTypeRaw = String(formData.get("course_type") ?? "").trim();
  const targetBandRaw = String(formData.get("target_band") ?? "").trim();
  const startDateRaw = String(formData.get("start_date") ?? "").trim();
  const endDateRaw = String(formData.get("end_date") ?? "").trim();
  const scheduleNote = String(formData.get("schedule_note") ?? "").trim();

  if (!name) {
    failTo(CLASS_STEP, "Give the class a name.");
  }

  // classes_name_length allows 1..200.
  if (name.length > 200) {
    failTo(CLASS_STEP, "Please use a class name of 200 characters or fewer.");
  }

  if (!isOfferedCourseType(courseTypeRaw)) {
    failTo(CLASS_STEP, "Choose a course type.");
  }
  const courseType = courseTypeRaw;

  if (!startDateRaw) {
    failTo(CLASS_STEP, "Choose a start date.");
  }

  const startDate = readDate(startDateRaw);
  if (!startDate) {
    failTo(CLASS_STEP, "That start date is not a real date.");
  }

  let endDate: string | null = null;
  if (endDateRaw) {
    endDate = readDate(endDateRaw);
    if (!endDate) {
      failTo(CLASS_STEP, "That end date is not a real date.");
    }

    // classes_end_after_start. Checked here so the teacher sees which field is
    // wrong instead of a constraint failure.
    if (endDate < startDate) {
      failTo(CLASS_STEP, "The end date cannot be before the start date.");
    }
  }

  const supabase = await createClient();

  const { data: created, error } = await supabase
    .from("classes")
    .insert({
      teacher_id: teacher.userId,
      name,
      course_type: courseType,
      // Derived, never submitted: the pair has to satisfy
      // classes_no_target_band_when_unscored, and only the server can be
      // trusted to keep them consistent.
      scoring_model: scoringModelFor(courseType),
      target_band: targetBandFor(courseType, targetBandRaw || null),
      start_date: startDate,
      end_date: endDate,
      schedule_note: scheduleNote || null,
    })
    .select("id")
    .single();

  if (error || !created) {
    logDbError("classes.insert", error ?? {});
    failTo(CLASS_STEP, "We could not create the class. Please try again.");
  }

  const code = await createInviteCode(supabase, created.id);

  if (!code) {
    // The class exists and is usable; only the shareable link is missing. Say
    // so rather than implying the whole step failed.
    failTo(
      INVITE_STEP,
      "The class was created, but we could not generate its invitation link. Please try again shortly.",
    );
  }

  revalidatePath("/onboarding", "layout");
  redirect(INVITE_STEP);
}

/**
 * Step 4 — invite one student by email.
 *
 * Order matters. The roster row is written first and the message is sent second,
 * because the row is what actually grants the invitation: `join_class_with_code`
 * claims a pending row by matching the joiner's *verified* address, so a student
 * who never receives the email can still be let in with the link. Sending first
 * and failing to record would produce the opposite — a promise with nothing
 * behind it.
 *
 * If the send fails the row is deliberately kept, and the invite page reports
 * that the invitation is saved but the email did not go out. `invite_email_sent_at`
 * is stamped only on a confirmed send, so the UI never claims delivery that did
 * not happen.
 */
export async function inviteStudentByEmail(formData: FormData) {
  const teacher = await requireTeacher();

  if (!teacher.currentClass) {
    redirect(CLASS_STEP);
  }

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (!email) {
    failTo(INVITE_STEP, "Enter a student's email address.");
  }

  // Deliberately loose: one @, no spaces, a dot in the domain. Anything
  // stricter rejects addresses that are valid, and the real test is whether the
  // student can confirm the address at sign-up.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    failTo(INVITE_STEP, "That does not look like an email address.");
  }

  const supabase = await createClient();
  const classId = teacher.currentClass.id;

  const { data: invite, error: inviteError } = await supabase
    .from("class_invite_codes")
    .select("code")
    .eq("class_id", classId)
    .eq("is_active", true)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (inviteError || !invite) {
    logDbError("class_invite_codes.select", inviteError ?? {});
    failTo(
      INVITE_STEP,
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
    failTo(INVITE_STEP, "We could not check the class list. Please try again.");
  }

  if (existing?.join_status === "joined") {
    failTo(INVITE_STEP, "That student has already joined this class.");
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
        INVITE_STEP,
        "We could not add that student to the class. Please try again.",
      );
    }

    memberId = inserted?.id ?? null;
  }

  const url = await joinUrl(invite.code);

  try {
    await sendMail(
      invitationEmail(email, {
        className: teacher.currentClass.name,
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

    revalidatePath("/onboarding", "layout");
    failTo(
      INVITE_STEP,
      `${email} was added to the class, but we could not send the email. Share the invitation link with them instead.`,
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

  // No success parameter: the invitation list on the step is read back from
  // class_members, so it is the confirmation, and it stays correct on a reload.
  revalidatePath("/onboarding", "layout");
  redirect(INVITE_STEP);
}
