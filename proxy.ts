import { NextResponse, type NextRequest } from "next/server";

import { createServerClient } from "@supabase/ssr";

import type { Database } from "@/lib/database.types";
import {
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from "@/lib/supabase/env";

/**
 * Supabase session refresh.
 *
 * `middleware.ts` is deprecated in Next.js 16 and renamed to `proxy.ts`; the
 * exported function is `proxy`, not `middleware`. Proxy defaults to the Node.js
 * runtime in v16, and setting a `runtime` config option in this file throws.
 *
 * SCOPE: this file refreshes the Supabase session and nothing else. It is
 * deliberately NOT the authorization boundary. Two reasons, both from the
 * Next.js proxy documentation:
 *
 *   - Server Functions are dispatched as POST requests to the route that uses
 *     them, so a matcher change or a refactor that relocates an action can
 *     silently drop proxy coverage — and with it any check that lived here.
 *   - Proxy may be deployed to a CDN edge, separate from the render runtime.
 *
 * Authorization belongs to Postgres RLS (enabled and FORCEd on all 13 tables)
 * with per-action checks in the Server Actions on top. This file only makes sure
 * that whatever RLS evaluates, it evaluates against a *fresh* token.
 *
 * Why it must exist at all: `lib/supabase/server.ts` cannot write cookies
 * during Server Component render — Next.js forbids it once streaming starts.
 * This is the one place in a normal page request where the response is still
 * writable, so it is where a refreshed token actually gets persisted.
 */
export async function proxy(request: NextRequest) {
  // Reassigned inside setAll. `NextResponse.next({ request })` is how the
  // updated cookie jar is handed to the downstream render, so the response has
  // to be rebuilt rather than mutated.
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          // Write to the *request* first so that this render sees the new
          // tokens, not just the browser on its next trip.
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }

          response = NextResponse.next({ request });

          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }

          // The second `setAll` parameter is new in @supabase/ssr 0.12.5 and is
          // not optional in practice. The library passes:
          //
          //   Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0
          //   Expires: 0
          //   Pragma: no-cache
          //
          // A response that carries a Set-Cookie for an auth token must never
          // be cached by a CDN or reverse proxy. If it is, that cache entry —
          // one user's session — gets replayed to whoever requests the same
          // path next. Dropping these headers produces a cross-user session
          // leak that is invisible in local development and only appears once
          // something like CloudFront, Vercel Edge or Cloudflare sits in front
          // of the app.
          //
          // Rebuilding the response above resets its headers, so these are set
          // after the rebuild, never before.
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  // This call is the entire point of the file, and it has to happen here rather
  // than later: a refresh that completes after the response is committed cannot
  // write its cookies anywhere, so the new token is lost and the next request
  // refreshes again.
  //
  // getClaims() rather than getUser(): the project uses publishable keys, hence
  // asymmetric JWT signing, so the token is verified locally via WebCrypto
  // against a cached JWKS — no Auth-server round trip per request — and an
  // about-to-expire session is refreshed first. The trade-off is that a session
  // revoked server-side stays valid here until the access token expires. Code
  // making a revocation-sensitive decision should call getUser(), which asks
  // the Auth server directly.
  //
  // The result is intentionally discarded. Errors are ignored too: a missing or
  // malformed token means "not signed in", which is a normal state for the
  // public routes this proxy also covers, not a reason to fail the request.
  await supabase.auth.getClaims();

  return response;
}

export const config = {
  /**
   * Everything except static assets. Without a matcher, proxy runs on every
   * request including `_next/static` and `public/` files, which would refresh
   * sessions while serving CSS.
   *
   * API and Route Handler paths are deliberately NOT excluded — `/auth/callback`
   * is a Route Handler, and any future handler needs the same refresh. Note that
   * proxy still runs for `_next/data` routes regardless of this pattern; that is
   * intentional Next.js behaviour so a protected page's data route cannot be
   * left uncovered.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf)$).*)",
  ],
};
