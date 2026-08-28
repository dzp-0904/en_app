import Link from "next/link";

import type { PageSearchParams } from "@/lib/route-types";
import { createClient } from "@/lib/supabase/server";

import { signInWithGoogle, signInWithPassword, signOut } from "../actions";

/**
 * Sign-in.
 *
 * Intentionally unstyled beyond the existing design tokens — the visual
 * implementation belongs to the Figma phase. It uses the semantic shadcn tokens
 * already defined in globals.css (`background`, `foreground`, `primary`,
 * `muted-foreground`, `destructive`, `input`) rather than raw palette values, so
 * the theme and dark mode apply without this file needing to change.
 *
 * A Server Component with plain form posts: no Client Component, no client-side
 * auth state, and the flow works with JavaScript disabled.
 */
export const metadata = {
  title: "Sign in · EduTrack",
};

export default async function LoginPage({ searchParams }: PageSearchParams) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;

  // Signed-in state lives here rather than on the landing page, which is still
  // create-next-app boilerplate owned by the Figma phase. This is also the only
  // place sign-out is currently reachable from the UI.
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const signedInAs =
    typeof data?.claims.email === "string" ? data.claims.email : null;

  if (signedInAs) {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Already signed in
          </h1>
          <p className="text-sm text-muted-foreground">
            You are signed in as{" "}
            <span className="font-medium text-foreground">{signedInAs}</span>.
          </p>
        </div>

        <form action={signOut}>
          <button
            type="submit"
            className="h-10 w-full rounded-md border border-input px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
          >
            Sign out
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Welcome back to EduTrack.
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      <form action={signInWithPassword} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <button
          type="submit"
          className="h-10 w-full rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Sign in
        </button>
      </form>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          or
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form action={signInWithGoogle}>
        <button
          type="submit"
          className="h-10 w-full rounded-md border border-input px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
        >
          Continue with Google
        </button>
      </form>

      <p className="text-sm text-muted-foreground">
        No account yet?{" "}
        <Link href="/auth/signup" className="font-medium text-foreground underline">
          Create one
        </Link>
      </p>
    </main>
  );
}
