"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { authErrorMessage } from "@/lib/auth-messages";
import { createClient } from "@/lib/supabase/server";

/**
 * Authentication Server Actions.
 *
 * These are Server Functions, which Next.js dispatches as POST requests to the
 * route that renders the form. Two consequences worth stating plainly:
 *
 *   - The forms work with JavaScript disabled, so no Client Component and no
 *     client-side auth state machine is needed for the core flow.
 *   - Per the Next.js proxy documentation, a proxy matcher cannot be relied on
 *     to guard a Server Function. Every action here therefore establishes its
 *     own session state through the Supabase client rather than trusting
 *     anything `proxy.ts` did.
 *
 * Errors are reported by redirecting back with an `error` query parameter. That
 * keeps the pages as Server Components with no `useActionState` boundary. The
 * provider writes its messages in English, so they pass through
 * `authErrorMessage` on the way to the screen — a translation only: the same
 * failures still occur, still redirect to the same page, and the translations
 * keep the originals' care not to leak whether an account exists.
 */

/** Redirects with a message attached. Returns `never` so callers narrow. */
function failTo(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

/**
 * Absolute origin of the current request, for OAuth and email-confirmation
 * return URLs.
 *
 * Derived from request headers rather than a new environment variable. That is
 * only acceptable because Supabase validates every `redirectTo` against the
 * project's Redirect URL allow-list and rejects anything not on it — the
 * allow-list, not this function, is what prevents a spoofed `Host` header from
 * turning into an open redirect. If the allow-list is ever widened with a broad
 * wildcard, this should become a pinned `NEXT_PUBLIC_SITE_URL` instead.
 */
async function requestOrigin(): Promise<string> {
  const headerList = await headers();

  // x-forwarded-host wins: behind a proxy, `host` is the internal hostname.
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");

  if (!host) {
    throw new Error(
      "Cannot determine the request origin: neither x-forwarded-host nor host " +
        "is present. An OAuth or email-confirmation redirect URL cannot be built.",
    );
  }

  // May arrive as a comma-separated list when several proxies are chained.
  const forwardedProto = headerList.get("x-forwarded-proto")?.split(",")[0]?.trim();

  // The dev server sets no x-forwarded-proto, so http has to be inferred for
  // loopback rather than defaulting everything to https.
  const isLoopback =
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("[::1]");

  const proto = forwardedProto ?? (isLoopback ? "http" : "https");

  return `${proto}://${host}`;
}

/** Email + password sign-in. */
export async function signInWithPassword(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    failTo("/auth/login", "Vui lòng nhập cả địa chỉ email và mật khẩu.");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    failTo("/auth/login", authErrorMessage(error.message, "signInWithPassword"));
  }

  // The session cookie just changed, so any cached RSC payload rendered for the
  // previous state is stale.
  revalidatePath("/", "layout");
  redirect("/");
}

/**
 * Email + password sign-up.
 *
 * Always creates a STUDENT. `role` is not accepted from this form and would be
 * ignored if it were: `app.handle_new_user` hard-codes `'student'` and reads
 * only `full_name` out of the signup metadata. Teacher promotion runs through
 * `app.provision_teacher`, which is executable by `service_role` alone and has
 * no path from browser or Server Action.
 */
export async function signUpWithPassword(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();

  if (!email || !password) {
    failTo("/auth/signup", "Vui lòng nhập cả địa chỉ email và mật khẩu.");
  }

  // profiles_full_name_length allows 1..120 characters. The trigger falls back
  // to the email local-part when no name is supplied, so an empty value is
  // acceptable; an over-long one would be silently truncated by the trigger's
  // left(v_name, 120), so it is rejected here where the user can see why.
  if (fullName.length > 120) {
    failTo("/auth/signup", "Vui lòng dùng tên không quá 120 ký tự.");
  }

  const supabase = await createClient();
  const origin = await requestOrigin();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Read by app.handle_new_user to populate profiles.full_name. Omitted
      // when blank so the trigger's email-local-part fallback applies instead
      // of an empty string, which the length CHECK would reject.
      data: fullName ? { full_name: fullName } : undefined,
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    failTo("/auth/signup", authErrorMessage(error.message, "signUp"));
  }

  // With email confirmation required — which product decision 14 mandates, and
  // which the database cannot enforce on its own — signUp returns a user but no
  // session. Nothing is signed in yet.
  //
  // This branch is also what an already-registered address hits: with Confirm
  // email enabled, Supabase returns an obfuscated user object and no error, so
  // that signup cannot be used to enumerate accounts. Showing the same "check
  // your inbox" result for both cases is the point, not an oversight.
  if (!data.session) {
    redirect(`/auth/signup?pending=${encodeURIComponent(email)}`);
  }

  // Reached only if Confirm email is disabled on the project, in which case
  // signUp signs the user straight in.
  revalidatePath("/", "layout");
  redirect("/");
}

/**
 * Starts the Google OAuth flow.
 *
 * `signInWithOAuth` does not redirect by itself — it returns the provider URL
 * and writes the PKCE code verifier to a cookie, which works here because a
 * Server Action can still set cookies. We then redirect the browser to Google,
 * which sends the user back to /auth/callback with a single-use code.
 */
export async function signInWithGoogle() {
  const supabase = await createClient();
  const origin = await requestOrigin();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    failTo("/auth/login", authErrorMessage(error.message, "signInWithOAuth"));
  }

  if (!data.url) {
    failTo(
      "/auth/login",
      "Hiện không thể đăng nhập bằng Google. Vui lòng thử lại.",
    );
  }

  redirect(data.url);
}

/**
 * Signs out of this browser only.
 *
 * `scope: "local"` is explicit because the library default is `"global"`, which
 * revokes every refresh token for the account — a teacher signing out on a
 * classroom laptop would also be signed out on their phone. That is the wrong
 * default for this product; a genuine "sign out everywhere" belongs in account
 * settings as a separate, clearly labelled action.
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });

  revalidatePath("/", "layout");
  redirect("/auth/login");
}
