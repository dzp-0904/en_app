import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { LogoMark } from "@/components/brand/logo-mark";
import { CopyField } from "@/components/onboarding/copy-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LABELS, isOfferedCourseType } from "@/lib/course-type";
import { loadUserState } from "@/lib/onboarding";
import type { DynamicPageProps } from "@/lib/route-types";
import { joinUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import { loadTeacherClass, type RosterEntry, type TeacherClassDetail } from "@/lib/teacher";

/**
 * One of the teacher's classes: what it is, how to invite people to it, and who
 * is in it.
 *
 * The roster is the point. Every table this milestone deliberately leaves alone
 * — attendance, scores, lesson logs, homework submissions — hangs off
 * `class_members.id`, so this list is the thing all of them will later be
 * recorded against. Showing it is what turns a class from a row created during
 * onboarding into something a teacher can work with.
 *
 * Identity comes from `loadUserState`, exactly as `/teacher` and the student
 * pages do. Ownership comes from `loadTeacherClass`, which cannot return a
 * class the caller does not own — the `classId` in the URL selects a row, it
 * does not authorise one.
 */

export const metadata: Metadata = {
  title: "Class",
};

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** `YYYY-MM-DD` read as a calendar date, not a moment in the viewer's zone. */
function asDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/** The facts worth showing, skipping every column this class left blank. */
function factsFor(detail: TeacherClassDetail): { term: string; value: string }[] {
  const facts: { term: string; value: string }[] = [];

  const course = isOfferedCourseType(detail.courseType)
    ? LABELS[detail.courseType]
    : detail.courseTypeOther;

  if (course) facts.push({ term: "Course", value: course });

  if (detail.targetBand !== null) {
    facts.push({ term: "Target", value: `IELTS ${detail.targetBand.toFixed(1)}` });
  }

  facts.push({
    term: "Dates",
    value: detail.endDate
      ? `${DATE.format(asDate(detail.startDate))} – ${DATE.format(asDate(detail.endDate))}`
      : `From ${DATE.format(asDate(detail.startDate))}`,
  });

  if (detail.scheduleNote) {
    facts.push({ term: "Schedule", value: detail.scheduleNote });
  }

  return facts;
}

export default async function TeacherClassPage({
  params,
}: DynamicPageProps<{ classId: string }>) {
  const { classId } = await params;

  const state = await loadUserState();

  if (state.kind === "anonymous") {
    redirect("/auth/login");
  }

  // Students and unplaceable accounts are `/`'s problem, as on `/teacher`.
  if (state.kind !== "teacher") {
    redirect("/");
  }

  const supabase = await createClient();
  const result = await loadTeacherClass(
    supabase,
    state.teacher.userId,
    classId,
  );

  // Another teacher's class is reported exactly as one that does not exist, so
  // the 404 says nothing about what other teachers run.
  if (result.kind === "not-found") {
    notFound();
  }

  if (result.kind === "error") {
    return (
      <Frame>
        {/* Not a 404: the query failed, and telling a teacher their class is
            gone when the database merely stumbled is the worse of the two. */}
        <Alert>
          We couldn&apos;t load this class just now. Please refresh the page.
        </Alert>
      </Frame>
    );
  }

  const { detail } = result;
  const link = detail.inviteCode ? await joinUrl(detail.inviteCode) : null;

  const students = detail.roster.filter((entry) => entry.status === "joined");
  const pending = detail.roster.filter((entry) => entry.status === "invited");

  return (
    <Frame>
      <h1 className="mb-8 font-serif text-2xl leading-relaxed text-foreground">
        {detail.className}
      </h1>

      <Card>
        <dl className="space-y-3">
          {factsFor(detail).map((fact) => (
            <div key={fact.term} className="flex gap-4 text-sm">
              <dt className="w-24 shrink-0 text-muted-foreground">
                {fact.term}
              </dt>
              <dd className="text-foreground">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <h2 className="mt-10 mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Invite students
      </h2>

      {link ? (
        <Card>
          {/* The panel carries its own bottom margin for the onboarding step it
              was built for; inside a card it is the only child, so remove it. */}
          <CopyField label="Class invitation link" value={link} />
          <p className="-mt-1 text-sm text-muted-foreground">
            Anyone with this link can join this class.
          </p>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-muted-foreground">
            This class has no active invitation link right now. Refresh the page
            in a moment to check again.
          </p>
        </Card>
      )}

      <h2 className="mt-10 mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Students ({students.length})
      </h2>

      {students.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            Nobody has joined yet. Share the invitation link above.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {students.map((entry) => (
            <li key={entry.membershipId}>
              <Card>
                <Person entry={entry} />
                {entry.joinedAt ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Joined {DATE.format(new Date(entry.joinedAt))}
                  </p>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {pending.length > 0 ? (
        <>
          <h2 className="mt-10 mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Pending invitations ({pending.length})
          </h2>

          <ul className="space-y-3">
            {pending.map((entry) => (
              <li key={entry.membershipId}>
                <Card>
                  <Person entry={entry} />
                  {/* `invite_email_sent_at` is stamped only after the SMTP
                      send resolves, so this never claims a delivery that did
                      not happen. */}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {entry.inviteEmailSentAt
                      ? `Invitation sent ${DATE.format(new Date(entry.inviteEmailSentAt))}`
                      : "Added, but the invitation email has not gone out — share the link with them."}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Frame>
  );
}

/**
 * One person's name and address.
 *
 * A pending invitation usually has an address and no name, so the address is
 * promoted to the heading rather than leaving an empty line above it.
 */
function Person({ entry }: { entry: RosterEntry }) {
  if (entry.name) {
    return (
      <>
        <h3 className="mb-1 font-semibold text-foreground">{entry.name}</h3>
        {entry.email ? (
          <p className="text-sm text-muted-foreground">{entry.email}</p>
        ) : null}
      </>
    );
  }

  return (
    <h3 className="font-semibold text-foreground">
      {entry.email ?? "Unnamed student"}
    </h3>
  );
}

/**
 * The shell every state shares — including the error state, which keeps the
 * back link so a failed load does not strand anyone on a page with no exit.
 */
function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 justify-center bg-background p-8">
      <div className="w-full max-w-lg">
        <LogoMark className="mb-12" />

        <Button asChild variant="ghost" size="inline" className="mb-6 text-sm">
          <Link href="/teacher">← Back to classes</Link>
        </Button>

        {children}
      </div>
    </main>
  );
}
