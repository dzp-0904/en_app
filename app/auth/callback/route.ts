import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { authErrorMessage } from "@/lib/auth-messages";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth and email-confirmation return point.
 *
 * Both flows land here with a single-use `code` in the query string, which is
 * exchanged for a session. A Route Handler is used rather than a page because
 * the exchange writes cookies, and because Google needs a plain GET endpoint to
 * redirect to.
 *
 * This URL must be present in the project's Supabase Redirect URL allow-list.
 * Until it is, Google sign-in and every confirmation email fail before reaching
 * this code.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const code = searchParams.get("code");

  // Supabase and OAuth providers report failures as query parameters on the
  // redirect rather than as an HTTP error — a denied consent screen, an expired
  // confirmation link, a misconfigured provider all arrive this way.
  const providerError =
    searchParams.get("error_description") ?? searchParams.get("error");

  if (providerError) {
    redirect(
      `/auth/login?error=${encodeURIComponent(
        authErrorMessage(providerError, "callback provider error"),
      )}`,
    );
  }

  if (!code) {
    redirect(
      `/auth/login?error=${encodeURIComponent(
        "Liên kết đăng nhập này không hợp lệ hoặc đã được sử dụng.",
      )}`,
    );
  }

  // New in this version of auth-js: when several PKCE flows are in flight, the
  // code must be exchanged with the verifier belonging to *its* flow, or the
  // mismatch consumes the single-use code for nothing. The flow id arrives as
  // the reserved `sb_flow_id` parameter, which the library reads automatically
  // in a browser — but this is a server-side handler, so it has to be read and
  // forwarded explicitly. Absent when the project has not enabled
  // appendPkceFlowIdToRedirects, in which case the most recent verifier is used
  // as before.
  const flowId = searchParams.get("sb_flow_id");

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(
    code,
    flowId ? { flowId } : undefined,
  );

  if (error) {
    redirect(
      `/auth/login?error=${encodeURIComponent(
        authErrorMessage(error.message, "exchangeCodeForSession"),
      )}`,
    );
  }

  revalidatePath("/", "layout");
  redirect(safeNext(searchParams.get("next")));
}

/**
 * Constrains the post-login destination to a path on this site.
 *
 * Without this, `?next=` would be an open redirect: an attacker could send a
 * victim a genuine, correctly-signed sign-in link that deposits them on a
 * hostile origin immediately after authenticating. Rejected values fall back to
 * the site root rather than erroring, since a bad `next` is not a reason to fail
 * an otherwise valid sign-in.
 */
function safeNext(value: string | null): string {
  if (!value) return "/";

  // Must be a site-relative path. `//host` and `/\host` are both read as
  // protocol-relative URLs by browsers, so a leading slash alone is not enough.
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";

  return value;
}
