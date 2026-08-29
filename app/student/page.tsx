import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { loadUserState } from "@/lib/onboarding";

export const metadata: Metadata = {
  title: "Your classes",
};

/**
 * The student's home.
 *
 * Deliberately the minimum that proves the routing and the membership query
 * work: who you are, which classes you are in, a way into each one, and a way
 * out. Everything about a class beyond its name lives on `/student/[classId]`,
 * so this stays a list rather than growing into a dashboard.
 *
 * Access control is `loadUserState` and, underneath it, RLS. A teacher who
 * types this URL is sent to `/`, which is where teachers are sorted; the query
 * behind `state.student.classes` is pinned to `auth.uid()` by
 * `class_members_student_select` regardless of what any page asks for.
 *
 * The brand, the account and the way out live in the application shell that
 * `app/student/layout.tsx` wraps this in, so they are not repeated below.
 */

const JOINED = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export default async function StudentPage() {
  const state = await loadUserState();

  if (state.kind === "anonymous") {
    redirect("/auth/login");
  }

  // Teachers and unplaceable accounts are both `/`'s problem, not this page's.
  if (state.kind !== "student") {
    redirect("/");
  }

  const { fullName, classes } = state.student;

  return (
    <main className="flex flex-1 justify-center bg-background p-8">
      <div className="w-full max-w-lg">
        <h1 className="mb-10 font-serif text-2xl leading-relaxed text-foreground">
          Welcome, {fullName}
        </h1>

        <h2 className="mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Your classes
        </h2>

        {classes === null ? (
          // Distinct from "no classes" on purpose: the query failed, and
          // telling someone who has joined a class that they have not is the
          // exact bug this page was written to fix.
          <Alert>
            We couldn&apos;t load your classes just now. Please refresh the page.
          </Alert>
        ) : classes.length === 0 ? (
          <Card>
            <p className="text-sm text-muted-foreground">
              You haven&apos;t joined a class yet. When your teacher sends you an
              invitation link, open it to join.
            </p>
          </Card>
        ) : (
          <ul className="space-y-3">
            {classes.map((entry) => (
              <li key={entry.membershipId}>
                <Card>
                  <h3 className="mb-1 font-semibold text-foreground">
                    {entry.className}
                  </h3>

                  {entry.teacherName ? (
                    <p className="text-sm text-muted-foreground">
                      Teacher: {entry.teacherName}
                    </p>
                  ) : null}

                  {entry.joinedAt ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Joined {JOINED.format(new Date(entry.joinedAt))}
                    </p>
                  ) : null}

                  {/* A plain link, not a clickable card: the whole surface
                      being a target would swallow anything added to it later,
                      and a link is what a keyboard and a screen reader can
                      actually find. */}
                  <Button asChild variant="outline" size="sm" className="mt-4">
                    <Link href={`/student/${entry.classId}`}>Open class</Link>
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
