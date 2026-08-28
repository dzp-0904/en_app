import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/database.types";

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./env";

/**
 * Supabase client for browser code (Client Components, event handlers).
 *
 * `createBrowserClient` is a singleton by default (`isSingleton` defaults to
 * true), so calling this repeatedly returns the same instance rather than
 * spawning a new auth state machine per call. We do not pass a `cookies`
 * option: with none supplied the client reads and writes `document.cookie`
 * directly, which is what makes the session visible to the server on the next
 * request. Supplying a custom store here would have to stay byte-compatible
 * with what `lib/supabase/server.ts` and `proxy.ts` read, so leaving it to the
 * library is both simpler and safer.
 *
 * The current auth foundation runs entirely through Server Actions and does not
 * yet need this client. It exists because anything reactive — an
 * `onAuthStateChange` subscription, a realtime channel, an optimistic mutation —
 * requires a browser-side client, and having one canonical constructor prevents
 * a second, subtly different one from appearing later.
 */
export function createClient() {
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}
