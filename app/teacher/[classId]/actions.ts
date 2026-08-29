"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { inviteStudentByEmail } from "@/app/onboarding/actions";
import { requireTeacher } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import { isUuid, loadEditableClass } from "@/lib/teacher";

/**
 * Roster management for one class: remove a student, cancel an invitation,
 * resend one.
 *
 * All three are the same shape as `updateClass`, for the same reasons. A Server
 * Function is a POST endpoint, so each one re-establishes who is calling
 * through `requireTeacher()` and re-establishes what they own through
 * `loadEditableClass()` — the fact that the only link to it sits on a page that
 * already did both is not a guard.
 *
 * Neither bound argument is trusted. `classId` names the class and
 * `membershipId` names the row; `authoriseRoster` turns the first into an
 * ownership decision, and every write below carries `.eq("class_id", classId)`
 * alongside `.eq("id", membershipId)` so a membership id from somebody else's
 * class matches nothing and writes nothing. Underneath both,
 * `class_members_teacher_all` refuses any statement touching a class outside
 * `app.my_class_ids()`. The URL selects a row; it does not grant one.
 *
 * None of them takes a `FormData` at all. There is nothing on these forms to
 * read, so the actions cannot be made to read anything.
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
 * Establishes the caller, the class they own, and where a failure returns to.
 *
 * The order is deliberate. Ownership is settled *before* the membership id is
 * looked at, so a request naming another teacher's class gets the same 404 it
 * would get for a class that does not exist, whatever it put in the second
 * argument — a forger cannot learn from the difference between "not your class"
 * and "no such member".
 *
 * The returned path is built from the bound segment, which has already been
 * proven to be a uuid naming a class this teacher owns. Nothing submitted can
 * name a redirect destination.
 */
async function authoriseRoster(
  classId: string,
  membershipId: string,
): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  classPath: string;
}> {
  const teacher = await requireTeacher();

  // A segment that cannot name a class is a wrong link, not a server fault.
  if (!isUuid(classId)) {
    notFound();
  }

  const classPath = `/teacher/${classId}`;
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
    failTo(classPath, "We could not load this class. Please try again.");
  }

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
