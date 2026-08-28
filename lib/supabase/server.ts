import { cookies } from "next/headers";

import { createServerClient } from "@supabase/ssr";

import type { Database } from "@/lib/database.types";

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./env";

/**
 * Supabase client for server code: Server Components, Server Actions and Route
 * Handlers.
 *
 * Must be called per request. Never hoist the result to a module-level constant
 * or memoise it across requests — the client closes over *this* request's cookie
 * store, so a shared instance would serve one user's session to another.
 *
 * `cookies()` is async in Next.js 16, hence the async factory.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // Whether this succeeds depends on *where* the client was created.
          //
          // In a Server Action or Route Handler it works: response headers are
          // still open, so a token refresh persists.
          //
          // During Server Component render it always throws. Next.js forbids
          // setting cookies once rendering has begun ("HTTP does not allow
          // setting cookies after streaming starts"), and there is no way to
          // detect the render phase from here to skip the attempt.
          //
          // Swallowing the throw is therefore correct rather than lazy — but it
          // is only safe because `proxy.ts` runs before every matched request
          // and refreshes the session there, where the response is still
          // writable. If the proxy is removed or its matcher stops covering a
          // route, refreshed tokens are silently dropped on that route and the
          // symptoms are the ones @supabase/ssr warns about: random logouts and
          // a storm of refresh requests. The proxy is load-bearing.
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Render phase — see above.
          }
        },
      },
    },
  );
}
