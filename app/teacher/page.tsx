import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LogoMark } from "@/components/brand/logo-mark";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { isOnboardingComplete, loadUserState } from "@/lib/onboarding";
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
 *
 * The brand, the account and the way out have moved into the application shell
 * that `app/teacher/layout.tsx` wraps this in, so they are not repeated below.
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

  const { userId, fullName } = state.teacher;

  // The same condition the layout uses to decide whether to draw the shell. A
  // teacher who has not finished setting up is not given it, and this page is
  // the only one under `/teacher` they can reach — so it carries the brand
  // itself rather than rendering with nothing at the top of it.
  const framed = isOnboardingComplete(state.teacher);

  const supabase = await createClient();
  const classes = await loadTeacherClasses(supabase, userId);

  return (
    <main className="flex flex-1 justify-center bg-background p-8">
      <div className="w-full max-w-lg">
        {framed ? null : <LogoMark className="mb-12" />}

        <h1 className="mb-10 font-serif text-2xl leading-relaxed text-foreground">
          Welcome back, {fullName}
        </h1>

        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Your classes
          </h2>

          {/* Only alongside a list. With no classes the empty state below makes
              the same offer in the teacher's own words, and repeating it here
              would give one action two buttons. */}
          {classes && classes.length > 0 ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/teacher/new">Create class</Link>
            </Button>
          ) : null}
        </div>

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
      </div>
    </main>
  );
}
