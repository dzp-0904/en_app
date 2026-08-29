import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { signOut } from "@/app/auth/actions";
import { LogoMark } from "@/components/brand/logo-mark";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { loadUserState } from "@/lib/onboarding";
import { loadTeacherClasses } from "@/lib/teacher";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Your classes",
};

/**
 * The teacher's home — the first page in the product that exists after
 * onboarding rather than during it.
 *
 * Until now `/` was the end of the teacher's road: it said the class was ready
 * and linked back into the wizard, which meant the only way to look at a class
 * was to re-enter setup. This is the list that was missing, and it is
 * deliberately the same shape as `/student`: who you are, what you have, a way
 * into each one, a way out.
 *
 * It is not a dashboard and reports on nothing. Sessions, attendance, scores,
 * homework and tuition all have tables and policies already, and none of them
 * is read here — a number on this page would have to come from somewhere.
 */
export default async function TeacherPage() {
  const state = await loadUserState();

  if (state.kind === "anonymous") {
    redirect("/auth/login");
  }

  // Students and unplaceable accounts are both `/`'s problem, not this page's.
  if (state.kind !== "teacher") {
    redirect("/");
  }

  const { userId, fullName, email } = state.teacher;

  const supabase = await createClient();
  const classes = await loadTeacherClasses(supabase, userId);

  return (
    <main className="flex flex-1 justify-center bg-background p-8">
      <div className="w-full max-w-lg">
        <LogoMark className="mb-12" />

        <h1 className="mb-1 font-serif text-2xl leading-relaxed text-foreground">
          Welcome back, {fullName}
        </h1>

        {email ? (
          <p className="mb-10 text-sm text-muted-foreground">
            Signed in as{" "}
            <span className="font-medium text-foreground">{email}</span>.
          </p>
        ) : null}

        <h2 className="mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Your classes
        </h2>

        {classes === null ? (
          // Distinct from "no classes" on purpose: the query failed, and a
          // teacher told they have none would reasonably go and make another.
          <Alert>
            We couldn&apos;t load your classes just now. Please refresh the page.
          </Alert>
        ) : classes.length === 0 ? (
          <Card>
            <p className="mb-5 text-sm text-muted-foreground">
              You haven&apos;t created a class yet.
            </p>
            <Button asChild>
              <Link href="/onboarding/class">Create your first class</Link>
            </Button>
          </Card>
        ) : (
          <ul className="space-y-3">
            {classes.map((entry) => (
              <li key={entry.classId}>
                <Card>
                  <h3 className="mb-1 font-semibold text-foreground">
                    {entry.className}
                  </h3>

                  <p className="text-sm text-muted-foreground">
                    {entry.studentCount === 1
                      ? "1 student"
                      : `${entry.studentCount} students`}
                    {entry.pendingCount > 0
                      ? ` · ${entry.pendingCount} pending`
                      : null}
                  </p>

                  <Button asChild variant="outline" size="sm" className="mt-4">
                    <Link href={`/teacher/${entry.classId}`}>Open class</Link>
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        )}

        <form action={signOut} className="mt-10">
          <Button type="submit" variant="outline">
            Sign out
          </Button>
        </form>
      </div>
    </main>
  );
}
