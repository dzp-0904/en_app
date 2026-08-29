"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  clearPendingJoin,
  normaliseInviteCode,
  rememberPendingJoin,
} from "@/lib/pending-join";
import { createClient } from "@/lib/supabase/server";

/**
 * Join-by-link Server Actions.
 *
 * The whole flow is `public.join_class_with_code`. Nothing here writes to
 * `class_members` directly, and it could not: students hold no INSERT or UPDATE
 * policy on that table at all. In particular the joiner's email address is never
 * sent from here — the function reads it from `auth.users` itself, which is what
 * stops someone claiming an invitation addressed to another person.
 *
 * The exceptions it raises carry SQLSTATEs chosen in the migration, and those
 * codes are the contract this file reads. The messages beside them are not shown
 * to anyone: they name tables and conditions, and the person on the other end
 * needs to know what to do instead.
 */

function joinPath(code: string): string {
  return `/join/${encodeURIComponent(code)}`;
}

/** Redirects back to the invitation with a message attached. */
function failTo(code: string, message: string): never {
  redirect(`${joinPath(code)}?error=${encodeURIComponent(message)}`);
}

/**
 * Parks the code, then sends the visitor to sign in or sign up.
 *
 * The auth flow is untouched: it always returns to `/`, and `/` is what reads
 * the cookie and brings them back here.
 */
export async function rememberAndAuthenticate(formData: FormData) {
  const code = normaliseInviteCode(String(formData.get("code") ?? ""));

  if (code) {
    await rememberPendingJoin(code);
  }

  const destination =
    String(formData.get("destination") ?? "") === "signup"
      ? "/auth/signup"
      : "/auth/login";

  redirect(destination);
}

/** Drops the parked invitation and returns to the site. */
export async function dismissInvitation() {
  await clearPendingJoin();
  redirect("/");
}

/** Adds the signed-in student to the class behind the code. */
export async function joinClass(formData: FormData) {
  const raw = String(formData.get("code") ?? "");
  const code = normaliseInviteCode(raw);

  if (!code) {
    redirect("/");
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("join_class_with_code", {
    p_code: code,
  });

  if (error) {
    console.error("[join] join_class_with_code failed", {
      code: error.code,
      message: error.message,
    });

    if (error.code === "28000") {
      // The session expired between rendering the page and submitting it. Park
      // the code so signing in lands back here.
      await rememberPendingJoin(code);
      redirect("/auth/login");
    }

    if (error.code === "42501") {
      failTo(code, permissionMessage(error.message));
    }

    if (error.code === "22023") {
      failTo(
        code,
        "This invitation link is no longer valid. Ask your teacher for a new one.",
      );
    }

    failTo(code, "We could not add you to this class. Please try again.");
  }

  const joined = data?.[0];

  await clearPendingJoin();
  revalidatePath("/", "layout");

  redirect(
    `${joinPath(code)}?joined=${encodeURIComponent(joined?.class_name ?? "")}`,
  );
}

/**
 * Translates the three 42501 cases into something actionable.
 *
 * Matching on the message text is matching this project's own migration, not a
 * PostgreSQL string that could change under us — the three `raise exception`
 * lines are in `20260828001300_rpcs.sql`. The default covers a fourth case being
 * added there without this file being updated.
 */
function permissionMessage(message: string): string {
  if (message.includes("only students")) {
    return "Teacher accounts cannot join a class. Sign in with your student account to accept this invitation.";
  }

  if (message.includes("confirmed")) {
    return "Confirm your email address first, then open this link again.";
  }

  if (message.includes("no email address")) {
    return "Your account has no email address, so it cannot join a class.";
  }

  return "Your account is not allowed to join this class.";
}
