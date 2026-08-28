import Link from "next/link";

import type { PageSearchParams } from "@/lib/route-types";

import { signInWithGoogle, signUpWithPassword } from "../actions";

/**
 * Sign-up.
 *
 * Public signup is student-only, by construction rather than by convention:
 * there is no role control on this form, and adding one would achieve nothing
 * because `app.handle_new_user` hard-codes `role = 'student'` and reads only
 * `full_name` from the signup metadata. Teacher accounts are provisioned by
 * `app.provision_teacher`, which only `service_role` may execute.
 */
export const metadata = {
  title: "Create an account · EduTrack",
};

export default async function SignUpPage({ searchParams }: PageSearchParams) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;
  const pending = typeof params.pending === "string" ? params.pending : undefined;

  // Reached when signUp returned no session, which is the expected outcome while
  // email confirmation is required. It is also what an already-registered
  // address produces — Supabase deliberately makes the two indistinguishable so
  // signup cannot be used to test whether an account exists, so this message
  // must not claim the account is new.
  if (pending) {
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Check your inbox
          </h1>
          <p className="text-sm text-muted-foreground">
            If an account can be created for{" "}
            <span className="font-medium text-foreground">{pending}</span>, a
            confirmation link is on its way. Open it to finish signing in.
          </p>
        </div>

        <p className="text-sm text-muted-foreground">
          <Link href="/auth/login" className="font-medium text-foreground underline">
            Back to sign in
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 p-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Create an account
        </h1>
        <p className="text-sm text-muted-foreground">
          Join your class on EduTrack.
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

      <form action={signUpWithPassword} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="full_name" className="block text-sm font-medium">
            Full name{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            id="full_name"
            name="full_name"
            type="text"
            autoComplete="name"
            maxLength={120}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

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
            autoComplete="new-password"
            required
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            Minimum length is set by your Supabase project&apos;s password policy.
          </p>
        </div>

        <button
          type="submit"
          className="h-10 w-full rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Create account
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
        Already have an account?{" "}
        <Link href="/auth/login" className="font-medium text-foreground underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
