import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth/auth-shell";
import { BrandPanel, type BrandPoint } from "@/components/auth/brand-panel";
import { GoogleButton } from "@/components/auth/google-button";
import { OrDivider } from "@/components/auth/or-divider";
import { SubmitButton } from "@/components/auth/submit-button";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PageSearchParams } from "@/lib/route-types";
import { createClient } from "@/lib/supabase/server";

import { signInWithGoogle, signInWithPassword, signOut } from "../actions";

export const metadata: Metadata = {
  title: "Sign in",
};

const TEXT_LINK =
  "rounded-sm font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * The Figma lists three live counters here — "32 students tracked", "4 active
 * classes", "86% homework completion" — alongside its mock teacher and its demo
 * login buttons. Those are prototype fixtures, and on a database with no users
 * they would be false claims made to a stranger at the door. The visual
 * treatment is kept exactly; the content is restated as capabilities, drawn
 * from the copy on the Figma's own sign-up panel.
 */
const POINTS: BrandPoint[] = [
  { label: "Track every student's IELTS progress" },
  { label: "Log a full lesson in under a minute" },
  { label: "Send parents a monthly report automatically" },
];

const BRAND = (
  <BrandPanel
    quoted
    headline="Teachers who track progress clearly teach more effectively."
    description="Designed for freelance English and IELTS teachers who care deeply about student outcomes."
    points={POINTS}
  />
);

/**
 * Sign-in.
 *
 * A Server Component driving plain form posts to the server actions in
 * `../actions`. There is no client-side auth state and no fetch on submit, so
 * the whole flow works with JavaScript disabled.
 */
export default async function LoginPage({ searchParams }: PageSearchParams) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;

  // Signed-in state lives here because this is still the only place sign-out is
  // reachable from the UI.
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const signedInAs =
    typeof data?.claims.email === "string" ? data.claims.email : null;

  if (signedInAs) {
    return (
      <AuthShell brand={BRAND}>
        <Card>
          <CardHeader>
            <CardTitle>You&apos;re already signed in</CardTitle>
            <CardDescription>
              Signed in as{" "}
              <span className="font-medium text-foreground">{signedInAs}</span>.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <form action={signOut}>
              <Button type="submit" variant="outline" className="w-full">
                Sign out
              </Button>
            </form>

            <p className="text-center text-sm text-muted-foreground">
              <Link href="/" className={TEXT_LINK}>
                Back to EduTrack
              </Link>
            </p>
          </CardContent>
        </Card>
      </AuthShell>
    );
  }

  return (
    <AuthShell brand={BRAND}>
      <div className="mb-8 space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">Welcome back</h1>
        <p className="text-sm text-muted-foreground">
          Sign in to your EduTrack account
        </p>
      </div>

      {error ? <Alert className="mb-5">{error}</Alert> : null}

      <form action={signInWithPassword} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@email.com"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            required
          />
        </div>

        <SubmitButton pendingLabel="Signing in…" className="w-full">
          Log in
        </SubmitButton>
      </form>

      <OrDivider className="my-5" />

      <form action={signInWithGoogle}>
        <GoogleButton label="Continue with Google" />
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href="/auth/signup" className={TEXT_LINK}>
          Create account
        </Link>
      </p>
    </AuthShell>
  );
}
